import { randomUUID } from "node:crypto";
import type { ExecuteValues, FieldPacket, QueryOptions, QueryResult, RowDataPacket } from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import { AuthRepository } from "../src/AuthRepository.js";
import { InventoryRepository } from "../src/InventoryRepository.js";
import { MealPlanRepository } from "../src/MealPlanRepository.js";
import { RecipeRepository } from "../src/RecipeRepository.js";
import type { Ingredient } from "../src/RecipeRepository.js";
import { MAX_SHOPPING_QUANTITY, ShoppingListBuilder } from "../src/ShoppingListBuilder.js";
import { ShoppingListRepository } from "../src/ShoppingListRepository.js";
import type { ShoppingInput, ShoppingItem } from "../src/ShoppingListRepository.js";
import { createDatabasePool, initializeDatabase } from "../src/database.js";

const pool = createDatabasePool("mealpilot_test");
const shopping = new ShoppingListRepository(pool);
const inventory = new InventoryRepository(pool);
const recipes = new RecipeRepository(pool);
const meals = new MealPlanRepository(pool);
const app = new Application(new AuthRepository(pool), { shopping }).app;
const emails: string[] = [];
const cookies: string[] = [];
const userIds: number[] = [];
const period = { startDate: "2027-04-01", endDate: "2027-04-07" };
const key = ShoppingListBuilder.key;

async function addItem(input: ShoppingInput, user = 0): Promise<ShoppingItem> {
  const response = await request(app).post("/api/shopping-list").set("Cookie", cookies[user])
    .send(input).expect(201);
  return response.body.item as ShoppingItem;
}

async function planRecipe(ingredients: Ingredient[], dates = [period.startDate], user = 0) {
  const recipe = await recipes.create(userIds[user], {
    name: "Shopping test recipe", category: "Dinner", preparationTime: 20, servings: 2,
    instructions: "Combine the ingredients and cook until ready.", ingredients,
  });
  for (const date of dates) await meals.create(userIds[user], { recipeId: recipe.id, date });
  return recipe;
}

beforeAll(async () => {
  await initializeDatabase("mealpilot_test");
  for (const name of ["Shopping owner", "Other shopping owner"]) {
    const email = `${randomUUID()}@example.com`;
    emails.push(email);
    const response = await request(app).post("/api/auth/register")
      .send({ name, email, password: "Shopping integration password" }).expect(201);
    cookies.push(response.headers["set-cookie"][0].split(";")[0] as string);
    userIds.push(response.body.user.id as number);
  }
});

beforeEach(async () => {
  // Each case clears only this suite's UUID accounts. Recipe deletion removes their planned meals.
  for (const userId of userIds) {
    await pool.execute("DELETE FROM shopping_items WHERE user_id = ?", [userId]);
    await pool.execute("DELETE FROM inventory_items WHERE user_id = ?", [userId]);
    await pool.execute("DELETE FROM recipes WHERE user_id = ?", [userId]);
  }
});

afterAll(async () => {
  try {
    for (const email of emails) await pool.execute("DELETE FROM users WHERE email = ?", [email]);
  } finally {
    await pool.end();
  }
});

describe("Shopping lists with a real database", () => {
  it("preserves decimal amounts, unknown amounts and purchase state across setup and restarts", async () => {
    const unknown = await request(app).post("/api/shopping-list").set("Cookie", cookies[0])
      .send({ name: "Salt" }).expect(201);
    expect(unknown.body.item).toEqual({ id: expect.any(Number), name: "Salt", quantity: null, unit: "", purchased: false });
    const measured = await addItem({ name: "Farmer's flour", quantity: 0.125, unit: "kg" });
    await request(app).patch(`/api/shopping-list/${measured.id}`).set("Cookie", cookies[0])
      .send({ purchased: true }).expect(200);
    await initializeDatabase("mealpilot_test");

    const otherPool = createDatabasePool("mealpilot_test");
    try {
      const restarted = new Application(new AuthRepository(otherPool), {
        shopping: new ShoppingListRepository(otherPool),
      });
      const response = await request(restarted.app).get("/api/shopping-list")
        .set("Cookie", cookies[0]).expect(200);
      expect(response.body.items).toEqual([unknown.body.item, { ...measured, purchased: true }]);
      const [rows] = await otherPool.execute<RowDataPacket[]>(
        "SELECT quantity FROM shopping_items WHERE id = ? AND user_id = ?", [unknown.body.item.id, userIds[0]],
      );
      expect(rows[0].quantity).toBeNull();
    } finally {
      await otherPool.end();
    }
  });

  it("accepts unchanged saves and purchase toggles while preserving the saved purchase state", async () => {
    const input = { name: "Rice", quantity: 1.375, unit: "kg" };
    const item = await addItem(input);
    for (const purchased of [true, true]) {
      const response = await request(app).patch(`/api/shopping-list/${item.id}`).set("Cookie", cookies[0])
        .send({ purchased }).expect(200);
      expect(response.body.item).toEqual({ ...item, purchased });
    }
    for (const quantity of [1.375, null, null]) {
      const response = await request(app).put(`/api/shopping-list/${item.id}`).set("Cookie", cookies[0])
        .send({ ...input, quantity, purchased: false }).expect(200);
      expect(response.body.item).toEqual({ ...item, quantity, purchased: true });
    }
    const restored = await request(app).patch(`/api/shopping-list/${item.id}`).set("Cookie", cookies[0])
      .send({ purchased: false }).expect(200);
    expect(restored.body.item).toEqual({ ...item, quantity: null });
    await request(app).delete(`/api/shopping-list/${item.id}`).set("Cookie", cookies[0]).send({}).expect(204);
    expect(await shopping.list(userIds[0])).toEqual([]);
  });

  it("previews repeated meals inside the inclusive period and subtracts only matching recorded amounts", async () => {
    await planRecipe([
      { name: "Flour", quantity: 1.25, unit: "kg" },
      { name: "Flour", quantity: 1, unit: "cup" },
      { name: "Rice", quantity: 1, unit: "cup" },
      { name: "Water", quantity: 0.25, unit: "l" },
    ], ["2027-03-31", period.startDate, period.endDate, "2027-04-08"]);
    await planRecipe([{ name: "Flour", quantity: 50, unit: "kg" }], [period.startDate], 1);
    await inventory.create(userIds[0], { name: " flour ", quantity: 0.5, unit: "KG" });
    await inventory.create(userIds[0], { name: "FLOUR", quantity: 0.25, unit: "kg" });
    await inventory.create(userIds[0], { name: "Rice", quantity: 0, unit: "cup" });
    await inventory.create(userIds[0], { name: "Rice", quantity: 20, unit: "kg" });
    await inventory.create(userIds[0], { name: "Water", quantity: null, unit: "l" });
    await inventory.create(userIds[1], { name: "Rice", quantity: 99, unit: "cup" });
    await addItem({ name: "Flour", quantity: 0.25, unit: "kg" });
    const purchased = await addItem({ name: "Flour", quantity: 9, unit: "kg" });
    await shopping.setPurchased(userIds[0], purchased.id, true);
    await addItem({ name: "Water", quantity: null, unit: "l" });
    const listBefore = await shopping.list(userIds[0]);
    const stockBefore = await inventory.list(userIds[0]);

    const response = await request(app).post("/api/shopping-list/preview").set("Cookie", cookies[0])
      .send(period).expect(200);
    expect(response.body).toEqual({
      mealCount: 2,
      suggestions: [
        { key: key("Flour", "cup"), name: "Flour", quantity: 2, unit: "cup", hasUnknownQuantity: false },
        { key: key("Flour", "kg"), name: "Flour", quantity: 1.5, unit: "kg", hasUnknownQuantity: false },
        { key: key("Rice", "cup"), name: "Rice", quantity: 2, unit: "cup", hasUnknownQuantity: false },
        { key: key("Water", "l"), name: "Water", quantity: 0.5, unit: "l", hasUnknownQuantity: true },
      ],
    });
    expect(await shopping.list(userIds[0])).toEqual(listBefore);
    expect(await inventory.list(userIds[0])).toEqual(stockBefore);
  });

  it("adds only selected shortages, merges pending amounts and does not add them again", async () => {
    await planRecipe([
      { name: "Flour", quantity: 2, unit: "kg" },
      { name: "Eggs", quantity: 4, unit: "" },
      { name: "Salt", quantity: 0.5, unit: "tsp" },
    ]);
    await inventory.create(userIds[0], { name: "Flour", quantity: 0.5, unit: "kg" });
    const flour = await addItem({ name: "FLOUR", quantity: 0.25, unit: "KG" });
    const salt = await addItem({ name: "Salt", quantity: null, unit: "tsp" });
    const selectedKeys = [key("Flour", "kg"), key("Eggs", ""), key("Flour", "kg"), key("Unrelated", "")];
    const first = await request(app).post("/api/shopping-list/generate").set("Cookie", cookies[0])
      .send({ ...period, selectedKeys }).expect(200);
    expect(first.body.addedCount).toBe(2);
    expect(first.body.items).toEqual([
      { id: expect.any(Number), name: "Eggs", quantity: 4, unit: "", purchased: false },
      { ...flour, quantity: 1.5 }, salt,
    ]);

    const repeated = await request(app).post("/api/shopping-list/generate").set("Cookie", cookies[0])
      .send({ ...period, selectedKeys }).expect(200);
    expect(repeated.body).toEqual({ addedCount: 0, items: first.body.items });
    expect(await shopping.preview(userIds[0], period)).toEqual({
      mealCount: 1,
      suggestions: [{ key: key("Salt", "tsp"), name: "Salt", quantity: 0.5, unit: "tsp", hasUnknownQuantity: true }],
    });
  });

  it("serializes simultaneous generation for the same owner without duplicate quantities", async () => {
    await planRecipe([{ name: "Tomato", quantity: 1.5, unit: "kg" }]);
    const body = { ...period, selectedKeys: [key("Tomato", "kg")] };
    const responses = await Promise.all([0, 1].map(() => request(app).post("/api/shopping-list/generate")
      .set("Cookie", cookies[0]).send(body).expect(200)));
    expect(responses.map((response) => response.body.addedCount).sort()).toEqual([0, 1]);
    expect(await shopping.list(userIds[0])).toEqual([
      { id: expect.any(Number), name: "Tomato", quantity: 1.5, unit: "kg", purchased: false },
    ]);
  });

  it("retries a real deadlock when different owners generate empty lists concurrently", async () => {
    const owners: number[] = [];
    // Fresh owner IDs share the empty gap beyond existing shopping rows, including deleted index entries.
    for (const quantity of [2, 3]) {
      const email = `${randomUUID()}@example.com`;
      emails.push(email);
      const owner = await new AuthRepository(pool).createUser("Concurrent shopping owner", email, "test-only-unused-hash");
      owners.push(owner.id);
      const recipe = await recipes.create(owner.id, {
        name: "Concurrent recipe", category: "Dinner", preparationTime: 1, servings: 1,
        instructions: "Prepare the ingredients.", ingredients: [{ name: "Tomato", quantity, unit: "kg" }],
      });
      await meals.create(owner.id, { recipeId: recipe.id, date: period.startDate });
    }
    let arrived = 0;
    let deadlocks = 0;
    let releaseBarrier = (): void => {};
    const barrier = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const timeout = setTimeout(releaseBarrier, 3000);
    const restoreConnections: Array<() => void> = [];
    const getConnection = pool.getConnection.bind(pool);
    const connectionSpy = vi.spyOn(pool, "getConnection").mockImplementation(async () => {
      const connection = await getConnection();
      const originalExecute = connection.execute;
      const execute = connection.execute.bind(connection);
      connection.execute = async <T extends QueryResult>(sql: string | QueryOptions, values?: ExecuteValues): Promise<[T, FieldPacket[]]> => {
        try {
          const result = typeof sql === "string" ? await execute<T>(sql, values) : await execute<T>(sql, values);
          if (arrived < 2 && typeof sql === "string" && sql.includes("FROM shopping_items") && sql.includes("FOR UPDATE")) {
            // Both empty-list gap locks must be held before either transaction starts inserting.
            arrived++;
            if (arrived === 2) releaseBarrier();
            await barrier;
          }
          return result;
        } catch (error) {
          if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_LOCK_DEADLOCK") deadlocks++;
          throw error;
        }
      };
      restoreConnections.push(() => { connection.execute = originalExecute; });
      return connection;
    });
    try {
      const results = await Promise.all(owners.map((owner) => shopping.generate(owner, period, [key("Tomato", "kg")])));
      expect(arrived).toBe(2);
      expect(deadlocks).toBe(1);
      expect(connectionSpy).toHaveBeenCalledTimes(3);
      for (const user of [0, 1]) {
        expect(results[user].addedCount).toBe(1);
        expect(await shopping.list(owners[user])).toEqual([
          { id: expect.any(Number), name: "Tomato", quantity: user + 2, unit: "kg", purchased: false },
        ]);
      }
    } finally {
      clearTimeout(timeout);
      releaseBarrier();
      connectionSpy.mockRestore();
      for (const restore of restoreConnections) restore();
    }
  });

  it("keeps unknown pending amounts intact when a measured shortage is selected", async () => {
    await planRecipe([{ name: "Olive oil", quantity: 0.3, unit: "l" }]);
    const unknown = await addItem({ name: "Olive oil", quantity: null, unit: "l" });
    await inventory.create(userIds[0], { name: "Olive oil", quantity: null, unit: "l" });
    const generated = await shopping.generate(userIds[0], period, [key("Olive oil", "l")]);
    expect(generated).toEqual({
      addedCount: 1,
      items: [unknown, { id: expect.any(Number), name: "Olive oil", quantity: 0.3, unit: "l", purchased: false }],
    });
    expect(await shopping.preview(userIds[0], period)).toEqual({ mealCount: 1, suggestions: [] });
  });

  it("recalculates saved stock and meals when an earlier preview is submitted", async () => {
    const recipe = await planRecipe([{ name: "Lentils", quantity: 2, unit: "cup" }]);
    const preview = await shopping.preview(userIds[0], period);
    const selectedKeys = preview.suggestions.map((suggestion) => suggestion.key);
    const stock = await inventory.create(userIds[0], { name: "Lentils", quantity: 2, unit: "cup" });
    const covered = await request(app).post("/api/shopping-list/generate").set("Cookie", cookies[0])
      .send({ ...period, selectedKeys, quantity: 99 }).expect(200);
    expect(covered.body).toEqual({ addedCount: 0, items: [] });

    await inventory.delete(userIds[0], stock.id);
    await recipes.delete(userIds[0], recipe.id);
    expect(await shopping.generate(userIds[0], period, selectedKeys)).toEqual({ addedCount: 0, items: [] });
  });

  it("isolates shopping data and generation even when another user submits the owner's ID", async () => {
    const item = await addItem({ name: "Rice", quantity: 1, unit: "cup" });
    await planRecipe([{ name: "Rice", quantity: 2, unit: "cup" }]);
    await planRecipe([{ name: "Rice", quantity: 5, unit: "cup" }], [period.startDate], 1);
    await inventory.create(userIds[0], { name: "Rice", quantity: 1, unit: "cup" });
    const other = await request(app).post("/api/shopping-list").set("Cookie", cookies[1])
      .send({ name: "Rice", quantity: 1, unit: "cup", userId: userIds[0], purchased: true }).expect(201);
    expect(other.body.item.purchased).toBe(false);
    const otherList = await request(app).get("/api/shopping-list").set("Cookie", cookies[1]).expect(200);
    expect(otherList.body.items).toEqual([other.body.item]);
    await request(app).put(`/api/shopping-list/${item.id}`).set("Cookie", cookies[1])
      .send({ name: "Changed", quantity: 99, userId: userIds[0] }).expect(404);
    await request(app).patch(`/api/shopping-list/${item.id}`).set("Cookie", cookies[1])
      .send({ purchased: true, userId: userIds[0] }).expect(404);
    await request(app).delete(`/api/shopping-list/${item.id}`).set("Cookie", cookies[1]).send({}).expect(404);
    const generated = await request(app).post("/api/shopping-list/generate").set("Cookie", cookies[1])
      .send({ ...period, selectedKeys: [key("Rice", "cup")], userId: userIds[0] }).expect(200);
    expect(generated.body).toEqual({ addedCount: 1, items: [{ ...other.body.item, quantity: 5 }] });
    expect(await shopping.list(userIds[0])).toEqual([item]);
  });

  it("preserves inventory, recipes and planned meals when generating, purchasing and removing items", async () => {
    const recipe = await planRecipe([{ name: "Beans", quantity: 2, unit: "cup" }]);
    await inventory.create(userIds[0], { name: "Beans", quantity: 0.5, unit: "cup" });
    const stockBefore = await inventory.list(userIds[0]);
    const mealsBefore = await meals.list(userIds[0]);
    const generated = await shopping.generate(userIds[0], period, [key("Beans", "cup")]);
    const item = generated.items[0];
    expect(item.quantity).toBe(1.5);
    await shopping.setPurchased(userIds[0], item.id, true);
    expect((await shopping.preview(userIds[0], period)).suggestions[0].quantity).toBe(1.5);
    await shopping.delete(userIds[0], item.id);
    expect(await inventory.list(userIds[0])).toEqual(stockBefore);
    expect(await recipes.find(userIds[0], recipe.id)).toEqual(recipe);
    expect(await meals.list(userIds[0])).toEqual(mealsBefore);
  });

  it("rejects a planned recipe with missing ingredients without changing the list", async () => {
    const recipe = await planRecipe([{ name: "Pasta", quantity: 1, unit: "box" }]);
    const item = await addItem({ name: "Milk", quantity: 1, unit: "l" });
    // Simulate inconsistent stored data without touching another suite's recipe.
    await pool.execute("DELETE FROM recipe_ingredients WHERE recipe_id = ?", [recipe.id]);
    await request(app).post("/api/shopping-list/preview").set("Cookie", cookies[0]).send(period).expect(500);
    await request(app).post("/api/shopping-list/generate").set("Cookie", cookies[0])
      .send({ ...period, selectedKeys: [key("Pasta", "box")] }).expect(500);
    expect(await shopping.list(userIds[0])).toEqual([item]);
  });

  it("rolls back earlier additions if a later merged quantity exceeds the database limit", async () => {
    const recipe = await planRecipe([
      { name: "Apples", quantity: 1, unit: "" },
      { name: "Zucchini", quantity: 9_999_999.999, unit: "kg" },
    ], []);
    // Repeated occurrences produce a large total while every stored ingredient remains valid.
    const occurrences = Array.from({ length: 1001 }, () => "(?, ?, ?)").join(", ");
    const values = Array.from({ length: 1001 }, () => [userIds[0], recipe.id, period.startDate]).flat();
    await pool.execute(`INSERT INTO planned_meals (user_id, recipe_id, planned_date) VALUES ${occurrences}`, values);
    const existing = await addItem({ name: "Zucchini", quantity: MAX_SHOPPING_QUANTITY, unit: "kg" });
    await expect(shopping.generate(userIds[0], period, [key("Apples", ""), key("Zucchini", "kg")]))
      .rejects.toThrow(RangeError);
    expect(await shopping.list(userIds[0])).toEqual([existing]);
  });

  it("removes a deleted account's shopping items through the database foreign key", async () => {
    const email = `${randomUUID()}@example.com`;
    emails.push(email);
    const response = await request(app).post("/api/auth/register")
      .send({ name: "Temporary shopping owner", email, password: "Shopping integration password" }).expect(201);
    const userId = response.body.user.id as number;
    const item = await shopping.create(userId, { name: "Bread", quantity: null, unit: "" });
    const other = await addItem({ name: "Bread", quantity: 1, unit: "loaf" }, 1);
    await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT id FROM shopping_items WHERE id = ?", [item.id]);
    expect(rows).toHaveLength(0);
    expect(await shopping.list(userIds[1])).toEqual([other]);
  });
});
