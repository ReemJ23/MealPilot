import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import { AuthRepository } from "../src/AuthRepository.js";
import { RecipeRepository } from "../src/RecipeRepository.js";
import type { Recipe, RecipeInput } from "../src/RecipeRepository.js";
import { createDatabasePool, initializeDatabase } from "../src/database.js";

const pool = createDatabasePool("mealpilot_test");
const repository = new RecipeRepository(pool);
const app = new Application(new AuthRepository(pool), { recipes: repository }).app;
const emails: string[] = [];
const cookies: string[] = [];
const userIds: number[] = [];
const sample: RecipeInput = {
  name: "Grandma's lentil soup",
  category: "Dinner",
  preparationTime: 25,
  servings: 2,
  instructions: "Rinse the lentils.\nSimmer with water until tender.",
  ingredients: [
    { name: "Lentils", quantity: 0.125, unit: "kg" },
    { name: "Water", quantity: 0.75, unit: "l" },
  ],
};

async function createRecipe(): Promise<Recipe> {
  const response = await request(app).post("/api/recipes").set("Cookie", cookies[0]).send(sample).expect(201);
  return response.body.recipe as Recipe;
}

beforeAll(async () => {
  await initializeDatabase("mealpilot_test");
  for (const name of ["Recipe owner", "Other user"]) {
    const email = `${randomUUID()}@example.com`;
    emails.push(email);
    const response = await request(app).post("/api/auth/register")
      .send({ name, email, password: "Recipe integration password" }).expect(201);
    cookies.push(response.headers["set-cookie"][0].split(";")[0] as string);
    userIds.push(response.body.user.id as number);
  }
});

afterAll(async () => {
  try {
    // Foreign keys clean up only these users' recipes, ingredients and sessions.
    for (const email of emails) await pool.execute("DELETE FROM users WHERE email = ?", [email]);
  } finally {
    await pool.end();
  }
});

describe("Recipes with a real database", () => {
  it("preserves full recipes across setup and application restarts", async () => {
    const recipe = await createRecipe();
    expect(recipe).toEqual({ ...sample, id: expect.any(Number) });
    await initializeDatabase("mealpilot_test");

    const otherPool = createDatabasePool("mealpilot_test");
    try {
      const restarted = new Application(new AuthRepository(otherPool), { recipes: new RecipeRepository(otherPool) });
      const response = await request(restarted.app).get(`/api/recipes/${recipe.id}`)
        .set("Cookie", cookies[0]).expect(200);
      expect(response.body.recipe).toEqual(recipe);
      expect(typeof response.body.recipe.ingredients[0].quantity).toBe("number");
    } finally {
      await otherPool.end();
    }
  });

  it("updates a recipe and replaces its ingredient rows", async () => {
    const recipe = await createRecipe();
    const changes: RecipeInput = {
      ...sample, name: "Carrot soup", servings: 3,
      ingredients: [{ name: "Carrots", quantity: 1.25, unit: "cup" }, { name: "Onion", quantity: 1, unit: "" }],
    };
    const response = await request(app).put(`/api/recipes/${recipe.id}`)
      .set("Cookie", cookies[0]).send(changes).expect(200);
    expect(response.body.recipe).toEqual({ ...changes, id: recipe.id });
    expect(await repository.find(userIds[0], recipe.id)).toEqual(response.body.recipe);

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT name FROM recipe_ingredients WHERE recipe_id = ? ORDER BY sort_order", [recipe.id],
    );
    expect(rows.map((row) => row.name)).toEqual(["Carrots", "Onion"]);
  });

  it("returns a consistent recipe when another request updates it during a read", async () => {
    const original = await createRecipe();
    const changes: RecipeInput = {
      ...sample, name: "Updated carrot soup", instructions: "Simmer the carrots until tender.",
      ingredients: [{ name: "Carrots", quantity: 2, unit: "cup" }],
    };
    const updated = { ...changes, id: original.id };
    const execute = pool.execute.bind(pool);
    const readThenUpdate = async (...args: Parameters<typeof pool.execute>) => {
      const result = await execute(...args);
      // Commit an edit after the read arrives but before find can use its result.
      await repository.update(userIds[0], original.id, changes);
      return result;
    };
    const pausedRead = vi.spyOn(pool, "execute")
      .mockImplementationOnce(readThenUpdate as typeof pool.execute);

    try {
      const observed = await repository.find(userIds[0], original.id);
      expect([original, updated]).toContainEqual(observed);
      expect(await repository.find(userIds[0], original.id)).toEqual(updated);
    } finally {
      pausedRead.mockRestore();
    }
  });

  it("isolates recipes even when another user supplies the owner's ID", async () => {
    const recipe = await createRecipe();
    const otherList = await request(app).get("/api/recipes").set("Cookie", cookies[1]).expect(200);
    expect(otherList.body.recipes.some((item: Recipe) => item.id === recipe.id)).toBe(false);
    await request(app).get(`/api/recipes/${recipe.id}`).set("Cookie", cookies[1]).expect(404);
    await request(app).put(`/api/recipes/${recipe.id}`).set("Cookie", cookies[1]).send(sample).expect(404);
    await request(app).delete(`/api/recipes/${recipe.id}`).set("Cookie", cookies[1]).send({}).expect(404);
    expect(await repository.find(userIds[0], recipe.id)).toEqual(recipe);

    const createdByOther = await request(app).post("/api/recipes").set("Cookie", cookies[1])
      .send({ ...sample, userId: userIds[0] }).expect(201);
    expect(await repository.find(userIds[0], createdByOther.body.recipe.id)).toBeNull();
    expect(await repository.find(userIds[1], createdByOther.body.recipe.id)).not.toBeNull();
  });

  it("deletes a recipe and its ingredients together", async () => {
    const recipe = await createRecipe();
    await request(app).delete(`/api/recipes/${recipe.id}`).set("Cookie", cookies[0]).send({}).expect(204);
    await request(app).get(`/api/recipes/${recipe.id}`).set("Cookie", cookies[0]).expect(404);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM recipe_ingredients WHERE recipe_id = ?", [recipe.id],
    );
    expect(rows[0].total).toBe(0);
  });

  it("rolls back an update if writing an ingredient fails", async () => {
    const recipe = await createRecipe();
    // Bypass API validation deliberately to exercise a database failure mid-transaction.
    const invalid: RecipeInput = {
      ...sample, name: "An update that must not persist",
      ingredients: [sample.ingredients[0], { name: null as unknown as string, quantity: 1, unit: "" }],
    };
    await expect(repository.update(userIds[0], recipe.id, invalid)).rejects.toThrow();
    expect(await repository.find(userIds[0], recipe.id)).toEqual(recipe);
  });

  it("rolls back creation if an ingredient cannot be saved", async () => {
    const before = await repository.list(userIds[0]);
    const invalid: RecipeInput = {
      ...sample,
      ingredients: [sample.ingredients[0], { name: null as unknown as string, quantity: 1, unit: "" }],
    };
    await expect(repository.create(userIds[0], invalid)).rejects.toThrow();
    expect(await repository.list(userIds[0])).toEqual(before);
  });
});
