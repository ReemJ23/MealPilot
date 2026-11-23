import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import type { AccountStore } from "../src/AuthRepository.js";
import type { Recipe, RecipeInput, RecipeStore, RecipeSummary } from "../src/RecipeRepository.js";

/** Focus route tests on validation and ownership. SQL is tested separately. */
class MemoryRecipeStore implements RecipeStore {
  private readonly records = new Map<number, { ownerId: number; recipe: Recipe }>();
  private nextId = 1;

  async list(userId: number): Promise<RecipeSummary[]> {
    return [...this.records.values()].filter((record) => record.ownerId === userId)
      .map(({ recipe }) => ({ id: recipe.id, name: recipe.name, category: recipe.category,
        preparationTime: recipe.preparationTime, servings: recipe.servings }))
      .sort((first, second) => second.id - first.id);
  }

  async find(userId: number, id: number): Promise<Recipe | null> {
    const record = this.records.get(id);
    return record?.ownerId === userId ? structuredClone(record.recipe) : null;
  }

  async create(userId: number, input: RecipeInput): Promise<Recipe> {
    const recipe = { ...structuredClone(input), id: this.nextId++ };
    this.records.set(recipe.id, { ownerId: userId, recipe });
    return structuredClone(recipe);
  }

  async update(userId: number, id: number, input: RecipeInput): Promise<Recipe | null> {
    if (this.records.get(id)?.ownerId !== userId) return null;
    const recipe = { ...structuredClone(input), id };
    this.records.set(id, { ownerId: userId, recipe });
    return structuredClone(recipe);
  }

  async delete(userId: number, id: number): Promise<boolean> {
    if (this.records.get(id)?.ownerId !== userId) return false;
    return this.records.delete(id);
  }
}

const firstToken = "a".repeat(64);
const secondToken = "b".repeat(64);
const firstCookie = `mealpilot_session=${firstToken}`;
const secondCookie = `mealpilot_session=${secondToken}`;
const sessions = new Map([
  [createHash("sha256").update(firstToken).digest("hex"), { id: 1, name: "Reem", email: "reem@example.com" }],
  [createHash("sha256").update(secondToken).digest("hex"), { id: 2, name: "Second user", email: "second@example.com" }],
]);
const input: RecipeInput = {
  name: "Lentil soup", category: "Dinner", preparationTime: 35, servings: 4,
  instructions: "Rinse the lentils.\nSimmer until tender.",
  ingredients: [{ name: "Lentils", quantity: 1.5, unit: "cup" }, { name: "Water", quantity: 750, unit: "ml" }],
};
let recipes: MemoryRecipeStore;
let app: Application["app"];

beforeEach(() => {
  recipes = new MemoryRecipeStore();
  const accounts: AccountStore = {
    createUser: vi.fn(), findUserByEmail: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(),
    findUserBySession: async (hash) => sessions.get(hash) ?? null,
  };
  app = new Application(accounts, { recipes }).app;
});

describe("Personal recipes API", () => {
  it("creates a trimmed recipe owned by the signed-in user", async () => {
    const response = await request(app).post("/api/recipes").set("Cookie", firstCookie)
      .send({ ...input, name: " Lentil soup ", category: " Dinner ", userId: 2, id: 99 });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ recipe: { id: 1, ...input } });
    expect(await recipes.list(1)).toHaveLength(1);
    expect(await recipes.list(2)).toHaveLength(0);
  });

  it("lists only the current user's recipes, newest first", async () => {
    await recipes.create(1, input);
    await recipes.create(2, { ...input, name: "Private recipe" });
    const newest = await recipes.create(1, { ...input, name: "Chickpea salad" });
    const response = await request(app).get("/api/recipes").set("Cookie", firstCookie);
    expect(response.status).toBe(200);
    expect(response.body.recipes.map((recipe: RecipeSummary) => recipe.name)).toEqual(["Chickpea salad", "Lentil soup"]);
    expect(response.body.recipes[0]).toEqual({ id: newest.id, name: newest.name, category: input.category,
      preparationTime: input.preparationTime, servings: input.servings });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("returns the full owned recipe with ordered ingredients", async () => {
    const recipe = await recipes.create(1, input);
    const response = await request(app).get(`/api/recipes/${recipe.id}`).set("Cookie", firstCookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recipe });
  });

  it("updates the recipe and replaces its ingredient list", async () => {
    const recipe = await recipes.create(1, input);
    const changed = { ...input, servings: 2, instructions: "Serve chilled.",
      ingredients: [{ name: "Tomatoes", quantity: 3, unit: "" }] };
    const response = await request(app).put(`/api/recipes/${recipe.id}`).set("Cookie", firstCookie).send(changed);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ recipe: { ...changed, id: recipe.id } });
    expect(await recipes.find(1, recipe.id)).toEqual(response.body.recipe);
  });

  it("deletes an owned recipe and returns an empty response", async () => {
    const recipe = await recipes.create(1, input);
    const deleted = await request(app).delete(`/api/recipes/${recipe.id}`).set("Cookie", firstCookie).send({});
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe("");
    await request(app).get(`/api/recipes/${recipe.id}`).set("Cookie", firstCookie).expect(404);
    expect(await recipes.list(1)).toEqual([]);
  });

  it("requires a session for every recipe operation", async () => {
    await request(app).get("/api/recipes").expect(401);
    await request(app).get("/api/recipes/1").expect(401);
    await request(app).post("/api/recipes").send(input).expect(401);
    await request(app).put("/api/recipes/1").send(input).expect(401);
    await request(app).delete("/api/recipes/1").send({}).expect(401);
  });

  it("hides other users' recipes and prevents changes to them", async () => {
    const recipe = await recipes.create(1, input);
    const path = `/api/recipes/${recipe.id}`;
    await request(app).get(path).set("Cookie", secondCookie).expect(404, { message: "Recipe not found." });
    await request(app).put(path).set("Cookie", secondCookie).send({ ...input, name: "Changed" }).expect(404);
    await request(app).delete(path).set("Cookie", secondCookie).send({}).expect(404);
    expect(await recipes.find(1, recipe.id)).toEqual(recipe);
  });

  it("returns the same not-found response for nonexistent recipe IDs", async () => {
    await request(app).get("/api/recipes/123").set("Cookie", firstCookie).expect(404, { message: "Recipe not found." });
    await request(app).put("/api/recipes/123").set("Cookie", firstCookie).send(input).expect(404);
    await request(app).delete("/api/recipes/123").set("Cookie", firstCookie).send({}).expect(404);
  });

  it.each(["0", "-1", "1.5", "abc", "1e2", "4294967296"])("rejects invalid recipe ID %s", async (id) => {
    await request(app).get(`/api/recipes/${id}`).set("Cookie", firstCookie).expect(400);
  });

  it.each([
    ["missing name", { name: " " }],
    ["long name", { name: "a".repeat(121) }],
    ["missing category", { category: "" }],
    ["missing instructions", { instructions: "" }],
    ["negative preparation time", { preparationTime: -1 }],
    ["fractional servings", { servings: 1.5 }],
    ["missing ingredients", { ingredients: [] }],
    ["invalid ingredient name", { ingredients: [{ name: "", quantity: 1, unit: "cup" }] }],
    ["zero quantity", { ingredients: [{ name: "Salt", quantity: 0, unit: "g" }] }],
    ["excess quantity precision", { ingredients: [{ name: "Salt", quantity: 0.1234, unit: "g" }] }],
    ["non-numeric quantity", { ingredients: [{ name: "Salt", quantity: "2", unit: "g" }] }],
    ["invalid unit", { ingredients: [{ name: "Salt", quantity: 1, unit: null }] }],
  ])("rejects %s without saving a recipe", async (_label, invalid) => {
    const response = await request(app).post("/api/recipes").set("Cookie", firstCookie).send({ ...input, ...invalid });
    expect(response.status).toBe(400);
    expect(response.body.message).toBeTypeOf("string");
    expect(await recipes.list(1)).toEqual([]);
  });

  it("accepts zero preparation time and an omitted ingredient unit", async () => {
    const response = await request(app).post("/api/recipes").set("Cookie", firstCookie)
      .send({ ...input, preparationTime: 0, ingredients: [{ name: "Tomato", quantity: 0.125 }] });
    expect(response.status).toBe(201);
    expect(response.body.recipe.ingredients).toEqual([{ name: "Tomato", quantity: 0.125, unit: "" }]);
  });

  it("keeps the existing recipe after an invalid update", async () => {
    const recipe = await recipes.create(1, input);
    await request(app).put(`/api/recipes/${recipe.id}`).set("Cookie", firstCookie)
      .send({ ...input, ingredients: [] }).expect(400);
    expect(await recipes.find(1, recipe.id)).toEqual(recipe);
  });

  it("applies the shared origin and JSON checks to recipe writes", async () => {
    await request(app).post("/api/recipes").set("Cookie", firstCookie)
      .set("Origin", "https://another-site.example").send(input).expect(403);
    await request(app).delete("/api/recipes/1").set("Cookie", firstCookie).type("form").send("ignored=value").expect(415);
    await request(app).post("/api/recipes").set("Cookie", firstCookie).type("json").send("{").expect(400);
    expect(await recipes.list(1)).toEqual([]);
  });

  it("returns a useful error without exposing a database failure", async () => {
    vi.spyOn(recipes, "list").mockRejectedValue(new Error("Private database details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await request(app).get("/api/recipes").set("Cookie", firstCookie);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Something went wrong. Please try again." });
    } finally {
      log.mockRestore();
    }
  });
});
