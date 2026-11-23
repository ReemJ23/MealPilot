import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import type { AccountStore } from "../src/AuthRepository.js";
import type { MealInput, MealPlanStore, PlannedMeal } from "../src/MealPlanRepository.js";

/** Route tests exercise the HTTP contract. Separate tests use the real database. */
class MemoryMealPlanStore implements MealPlanStore {
  readonly recipes = new Map([
    [1, { ownerId: 1, name: "Lentil soup" }],
    [2, { ownerId: 1, name: "Chickpea salad" }],
    [3, { ownerId: 2, name: "Another user's recipe" }],
  ]);
  private readonly records = new Map<number, { ownerId: number; meal: PlannedMeal }>();
  private nextId = 1;

  async list(userId: number): Promise<PlannedMeal[]> {
    return [...this.records.values()].filter((record) => record.ownerId === userId)
      .map(({ meal }) => ({ ...meal })).sort((first, second) => first.date.localeCompare(second.date) || first.id - second.id);
  }

  async create(userId: number, input: MealInput): Promise<PlannedMeal | null> {
    const recipe = this.recipes.get(input.recipeId);
    if (recipe?.ownerId !== userId) return null;
    const meal = { ...input, id: this.nextId++, recipeName: recipe.name };
    this.records.set(meal.id, { ownerId: userId, meal });
    return { ...meal };
  }

  async update(userId: number, id: number, input: MealInput): Promise<PlannedMeal | null> {
    const recipe = this.recipes.get(input.recipeId);
    if (this.records.get(id)?.ownerId !== userId || recipe?.ownerId !== userId) return null;
    const meal = { ...input, id, recipeName: recipe.name };
    this.records.set(id, { ownerId: userId, meal });
    return { ...meal };
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
const input: MealInput = { recipeId: 1, date: "2026-11-23" };
let meals: MemoryMealPlanStore;
let app: Application["app"];

beforeEach(() => {
  meals = new MemoryMealPlanStore();
  const accounts: AccountStore = {
    createUser: vi.fn(), findUserByEmail: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(),
    findUserBySession: async (hash) => sessions.get(hash) ?? null,
  };
  app = new Application(accounts, { meals }).app;
});

describe("Meal calendar API", () => {
  it("assigns an owned recipe using the signed-in user's calendar", async () => {
    const response = await request(app).post("/api/meals").set("Cookie", firstCookie)
      .send({ ...input, userId: 2, id: 99 });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ meal: { id: 1, ...input, recipeName: "Lentil soup" } });
    expect(await meals.list(1)).toEqual([response.body.meal]);
    expect(await meals.list(2)).toEqual([]);
  });

  it("lists only owned meals in date order and allows several meals on one date", async () => {
    const later = await meals.create(1, { ...input, date: "2026-11-24" });
    const first = await meals.create(1, input);
    const duplicate = await meals.create(1, input);
    await meals.create(2, { recipeId: 3, date: input.date });
    const response = await request(app).get("/api/meals").set("Cookie", firstCookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ meals: [first, duplicate, later] });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("changes the saved recipe and moves the planned meal to another date", async () => {
    const created = await meals.create(1, input);
    const changed = { recipeId: 2, date: "2026-12-01" };
    const response = await request(app).put(`/api/meals/${created!.id}`).set("Cookie", firstCookie).send(changed);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ meal: { id: created!.id, ...changed, recipeName: "Chickpea salad" } });
    expect(await meals.list(1)).toEqual([response.body.meal]);
  });

  it("accepts saving a planned meal without changing it", async () => {
    const created = await meals.create(1, input);
    await request(app).put(`/api/meals/${created!.id}`).set("Cookie", firstCookie).send(input)
      .expect(200, { meal: created });
  });

  it("removes a planned meal without removing its saved recipe", async () => {
    const created = await meals.create(1, input);
    const response = await request(app).delete(`/api/meals/${created!.id}`).set("Cookie", firstCookie).send({});
    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(await meals.list(1)).toEqual([]);
    await request(app).post("/api/meals").set("Cookie", firstCookie).send(input).expect(201);
  });

  it("requires a session for every calendar operation", async () => {
    await request(app).get("/api/meals").expect(401);
    await request(app).post("/api/meals").send(input).expect(401);
    await request(app).put("/api/meals/1").send(input).expect(401);
    await request(app).delete("/api/meals/1").send({}).expect(401);
  });

  it("prevents another user from changing or removing an owned calendar entry", async () => {
    const created = await meals.create(1, input);
    const path = `/api/meals/${created!.id}`;
    await request(app).put(path).set("Cookie", secondCookie).send({ recipeId: 3, date: "2026-12-01" })
      .expect(404, { message: "Planned meal or recipe not found." });
    await request(app).delete(path).set("Cookie", secondCookie).send({})
      .expect(404, { message: "Planned meal not found." });
    expect(await meals.list(1)).toEqual([created]);
  });

  it("returns not found for a missing planned meal", async () => {
    await request(app).put("/api/meals/123").set("Cookie", firstCookie).send(input)
      .expect(404, { message: "Planned meal or recipe not found." });
    await request(app).delete("/api/meals/123").set("Cookie", firstCookie).send({})
      .expect(404, { message: "Planned meal not found." });
  });

  it("treats missing and another user's recipes alike without changing the plan", async () => {
    const created = await meals.create(1, input);
    for (const recipeId of [3, 999]) {
      await request(app).post("/api/meals").set("Cookie", firstCookie).send({ ...input, recipeId })
        .expect(404, { message: "Recipe not found." });
      await request(app).put(`/api/meals/${created!.id}`).set("Cookie", firstCookie).send({ ...input, recipeId })
        .expect(404, { message: "Planned meal or recipe not found." });
    }
    expect(await meals.list(1)).toEqual([created]);
  });

  it("preserves valid leap days and the supported date boundaries", async () => {
    for (const date of ["2028-02-29", "1000-01-01", "9999-12-31"]) {
      const response = await request(app).post("/api/meals").set("Cookie", firstCookie).send({ ...input, date });
      expect(response.status).toBe(201);
      expect(response.body.meal.date).toBe(date);
    }
  });

  it.each(["2026-02-29", "2026-13-01", "2026-11-23T00:00:00Z", "2026-1-2", "0999-01-01", "10000-01-01"])(
    "rejects invalid calendar date %s", async (date) => {
      await request(app).post("/api/meals").set("Cookie", firstCookie).send({ ...input, date }).expect(400);
      expect(await meals.list(1)).toEqual([]);
    },
  );

  it("requires a positive integer recipe ID within the database range", async () => {
    for (const recipeId of [0, -1, 1.5, "1", 4_294_967_296]) {
      await request(app).post("/api/meals").set("Cookie", firstCookie).send({ ...input, recipeId }).expect(400);
    }
    expect(await meals.list(1)).toEqual([]);
  });

  it("rejects invalid planned meal IDs before updating or deleting", async () => {
    for (const id of ["0", "abc", "1e2", "4294967296"]) {
      await request(app).put(`/api/meals/${id}`).set("Cookie", firstCookie).send(input).expect(400);
      await request(app).delete(`/api/meals/${id}`).set("Cookie", firstCookie).send({}).expect(400);
    }
  });

  it("rejects incomplete or invalid request objects", async () => {
    for (const body of [[], { recipeId: 1 }, { date: input.date }, { ...input, date: 20261123 }]) {
      await request(app).post("/api/meals").set("Cookie", firstCookie).send(body).expect(400);
    }
    expect(await meals.list(1)).toEqual([]);
  });

  it("preserves the existing plan after an invalid update", async () => {
    const created = await meals.create(1, input);
    await request(app).put(`/api/meals/${created!.id}`).set("Cookie", firstCookie)
      .send({ ...input, date: "2026-02-29" }).expect(400);
    expect(await meals.list(1)).toEqual([created]);
  });

  it("applies the shared origin and JSON checks to calendar writes", async () => {
    await request(app).post("/api/meals").set("Cookie", firstCookie)
      .set("Origin", "https://another-site.example").send(input).expect(403);
    await request(app).delete("/api/meals/1").set("Cookie", firstCookie).type("form").send("ignored=value").expect(415);
    await request(app).post("/api/meals").set("Cookie", firstCookie).type("json").send("{").expect(400);
    expect(await meals.list(1)).toEqual([]);
  });

  it("returns a useful error without exposing database details", async () => {
    vi.spyOn(meals, "list").mockRejectedValue(new Error("Private database details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await request(app).get("/api/meals").set("Cookie", firstCookie);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Something went wrong. Please try again." });
    } finally {
      log.mockRestore();
    }
  });
});
