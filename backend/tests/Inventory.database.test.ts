import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Application } from "../src/Application.js";
import { AuthRepository } from "../src/AuthRepository.js";
import { InventoryRepository } from "../src/InventoryRepository.js";
import type { InventoryInput, InventoryItem } from "../src/InventoryRepository.js";
import { MealPlanRepository } from "../src/MealPlanRepository.js";
import { RecipeRepository } from "../src/RecipeRepository.js";
import { createDatabasePool, initializeDatabase } from "../src/database.js";

const pool = createDatabasePool("mealpilot_test");
const inventory = new InventoryRepository(pool);
const app = new Application(new AuthRepository(pool), { inventory }).app;
const emails: string[] = [];
const cookies: string[] = [];
const userIds: number[] = [];
const sample: InventoryInput = { name: "Farmer's flour", quantity: 0.125, unit: "kg" };

async function addItem(input: InventoryInput = sample, user = 0): Promise<InventoryItem> {
  const response = await request(app).post("/api/inventory").set("Cookie", cookies[user])
    .send(input).expect(201);
  return response.body.item as InventoryItem;
}

beforeAll(async () => {
  await initializeDatabase("mealpilot_test");
  for (const name of ["Inventory owner", "Other inventory owner"]) {
    const email = `${randomUUID()}@example.com`;
    emails.push(email);
    const response = await request(app).post("/api/auth/register")
      .send({ name, email, password: "Inventory integration password" }).expect(201);
    cookies.push(response.headers["set-cookie"][0].split(";")[0] as string);
    userIds.push(response.body.user.id as number);
  }
});

afterAll(async () => {
  try {
    // Foreign keys remove only data belonging to these generated accounts.
    for (const email of emails) await pool.execute("DELETE FROM users WHERE email = ?", [email]);
  } finally {
    await pool.end();
  }
});

describe("Kitchen inventory with a real database", () => {
  it("preserves inventory across repeated setup and application restarts", async () => {
    const item = await addItem();
    expect(item).toEqual({ ...sample, id: expect.any(Number) });
    await initializeDatabase("mealpilot_test");

    const otherPool = createDatabasePool("mealpilot_test");
    try {
      const restarted = new Application(new AuthRepository(otherPool), {
        inventory: new InventoryRepository(otherPool),
      });
      const response = await request(restarted.app).get("/api/inventory")
        .set("Cookie", cookies[0]).expect(200);
      expect(response.body.items).toContainEqual(item);
    } finally {
      await otherPool.end();
    }
  });

  it("keeps unrecorded, zero and decimal quantities distinct after reading them back", async () => {
    const omitted = await request(app).post("/api/inventory").set("Cookie", cookies[0])
      .send({ name: "Salt" }).expect(201);
    const unknown = await addItem({ name: "Pepper", quantity: null, unit: "jar" });
    const empty = await addItem({ name: "Rice", quantity: 0, unit: "kg" });
    const measured = await addItem({ name: "Olive oil", quantity: 0.375, unit: "l" });

    expect(omitted.body.item).toEqual({ id: expect.any(Number), name: "Salt", quantity: null, unit: "" });
    const response = await request(app).get("/api/inventory").set("Cookie", cookies[0]).expect(200);
    expect(response.body.items).toEqual(expect.arrayContaining([omitted.body.item, unknown, empty, measured]));
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT quantity FROM inventory_items WHERE id = ? AND user_id = ?", [unknown.id, userIds[0]],
    );
    expect(rows[0].quantity).toBeNull();
  });

  it("updates an item, accepts an unchanged save and can clear its quantity", async () => {
    const item = await addItem();
    const changes: InventoryInput = { name: "Wholemeal flour", quantity: 2.5, unit: "cup" };
    const expected = { ...changes, id: item.id };
    const updated = await request(app).put(`/api/inventory/${item.id}`).set("Cookie", cookies[0])
      .send(changes).expect(200);
    expect(updated.body.item).toEqual(expected);
    const unchanged = await request(app).put(`/api/inventory/${item.id}`).set("Cookie", cookies[0])
      .send(changes).expect(200);
    expect(unchanged.body.item).toEqual(expected);

    const cleared = await request(app).put(`/api/inventory/${item.id}`).set("Cookie", cookies[0])
      .send({ ...changes, quantity: null, unit: "" }).expect(200);
    expect(cleared.body.item).toEqual({ ...expected, quantity: null, unit: "" });
    expect(await inventory.list(userIds[0])).toContainEqual(cleared.body.item);
  });

  it("lists ingredients alphabetically and keeps separate entries with the same name", async () => {
    const zucchini = await addItem({ name: "Zucchini", quantity: 2, unit: "" });
    const first = await addItem({ name: "Apples", quantity: 1, unit: "bag" });
    const second = await addItem({ name: "Apples", quantity: 3, unit: "" });
    const ids = [zucchini.id, first.id, second.id];
    const listed = (await inventory.list(userIds[0])).filter((item) => ids.includes(item.id));
    expect(listed).toEqual([first, second, zucchini]);
  });

  it("isolates inventory even when another user submits the owner's ID", async () => {
    const item = await addItem();
    const otherList = await request(app).get("/api/inventory").set("Cookie", cookies[1]).expect(200);
    expect(otherList.body.items).not.toContainEqual(item);
    await request(app).put(`/api/inventory/${item.id}`).set("Cookie", cookies[1])
      .send({ ...sample, name: "Changed by another user", userId: userIds[0] }).expect(404);
    await request(app).delete(`/api/inventory/${item.id}`).set("Cookie", cookies[1]).send({}).expect(404);
    expect(await inventory.list(userIds[0])).toContainEqual(item);

    const spoofed = await request(app).post("/api/inventory").set("Cookie", cookies[1])
      .send({ ...sample, userId: userIds[0] }).expect(201);
    expect(await inventory.list(userIds[1])).toContainEqual(spoofed.body.item);
    expect(await inventory.list(userIds[0])).not.toContainEqual(spoofed.body.item);
  });

  it("removes only the selected inventory item and preserves recipes and planned meals", async () => {
    const item = await addItem({ name: "Lentils", quantity: 1, unit: "cup" });
    const recipes = new RecipeRepository(pool);
    const meals = new MealPlanRepository(pool);
    const recipe = await recipes.create(userIds[0], {
      name: "Lentil soup", category: "Dinner", preparationTime: 25, servings: 2,
      instructions: "Simmer the lentils until tender.",
      ingredients: [{ name: "Lentils", quantity: 1, unit: "cup" }],
    });
    const meal = await meals.create(userIds[0], { recipeId: recipe.id, date: "2027-03-15" });
    expect(meal).not.toBeNull();
    const otherItem = await addItem({ name: "Lentils", quantity: 2, unit: "bag" });
    await request(app).delete(`/api/inventory/${item.id}`).set("Cookie", cookies[0]).send({}).expect(204);

    const items = await inventory.list(userIds[0]);
    expect(items.some((saved) => saved.id === item.id)).toBe(false);
    expect(items).toContainEqual(otherItem);
    expect(await recipes.find(userIds[0], recipe.id)).toEqual(recipe);
    expect(await meals.list(userIds[0])).toContainEqual(meal);
  });

  it("removes a deleted user's inventory through the database foreign key", async () => {
    const email = `${randomUUID()}@example.com`;
    emails.push(email);
    const registered = await request(app).post("/api/auth/register")
      .send({ name: "Temporary inventory owner", email, password: "Inventory integration password" }).expect(201);
    const userId = registered.body.user.id as number;
    const item = await inventory.create(userId, sample);
    await pool.execute("DELETE FROM users WHERE id = ?", [userId]);
    const [rows] = await pool.execute<RowDataPacket[]>("SELECT id FROM inventory_items WHERE id = ?", [item.id]);
    expect(rows).toHaveLength(0);
  });
});
