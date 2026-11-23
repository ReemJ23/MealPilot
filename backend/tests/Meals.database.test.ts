import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Application } from "../src/Application.js";
import { AuthRepository } from "../src/AuthRepository.js";
import { MealPlanRepository } from "../src/MealPlanRepository.js";
import type { PlannedMeal } from "../src/MealPlanRepository.js";
import { RecipeRepository } from "../src/RecipeRepository.js";
import type { RecipeInput } from "../src/RecipeRepository.js";
import { createDatabasePool, initializeDatabase } from "../src/database.js";

const pool = createDatabasePool("mealpilot_test");
const recipes = new RecipeRepository(pool);
const meals = new MealPlanRepository(pool);
const app = new Application(new AuthRepository(pool), { recipes, meals }).app;
const emails: string[] = [];
const cookies: string[] = [];
const userIds: number[] = [];
const sample: RecipeInput = {
  name: "Lentil soup",
  category: "Dinner",
  preparationTime: 25,
  servings: 2,
  instructions: "Simmer the lentils until tender.",
  ingredients: [{ name: "Lentils", quantity: 1, unit: "cup" }],
};

async function planMeal(recipeId: number, date: string, user = 0): Promise<PlannedMeal> {
  const response = await request(app).post("/api/meals").set("Cookie", cookies[user])
    .send({ recipeId, date }).expect(201);
  return response.body.meal as PlannedMeal;
}

beforeAll(async () => {
  await initializeDatabase("mealpilot_test");
  for (const name of ["Calendar owner", "Other calendar owner"]) {
    const email = `${randomUUID()}@example.com`;
    emails.push(email);
    const response = await request(app).post("/api/auth/register")
      .send({ name, email, password: "Calendar integration password" }).expect(201);
    cookies.push(response.headers["set-cookie"][0].split(";")[0] as string);
    userIds.push(response.body.user.id as number);
  }
});

afterAll(async () => {
  try {
    // Cascades remove only the calendar data belonging to these generated accounts.
    for (const email of emails) await pool.execute("DELETE FROM users WHERE email = ?", [email]);
  } finally {
    await pool.end();
  }
});

describe("Meal plans with a real database", () => {
  it("preserves calendar dates across repeated setup and application restarts", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    const meal = await planMeal(recipe.id, "2028-02-29");
    expect(meal).toEqual({ id: expect.any(Number), recipeId: recipe.id, recipeName: recipe.name, date: "2028-02-29" });
    await initializeDatabase("mealpilot_test");

    const otherPool = createDatabasePool("mealpilot_test");
    try {
      const restarted = new Application(new AuthRepository(otherPool), {
        recipes: new RecipeRepository(otherPool), meals: new MealPlanRepository(otherPool),
      });
      const response = await request(restarted.app).get("/api/meals").set("Cookie", cookies[0]).expect(200);
      expect(response.body.meals).toContainEqual(meal);
    } finally {
      await otherPool.end();
    }
  });

  it("changes the recipe and date and accepts saving an unchanged meal", async () => {
    const original = await recipes.create(userIds[0], sample);
    const replacement = await recipes.create(userIds[0], { ...sample, name: "Vegetable rice" });
    const meal = await planMeal(original.id, "2027-03-13");
    const changes = { recipeId: replacement.id, date: "2027-03-14" };
    const expected = { id: meal.id, ...changes, recipeName: replacement.name };

    // A daylight-saving boundary must still be stored as the selected calendar date.
    const updated = await request(app).put(`/api/meals/${meal.id}`).set("Cookie", cookies[0])
      .send(changes).expect(200);
    expect(updated.body.meal).toEqual(expected);
    const unchanged = await request(app).put(`/api/meals/${meal.id}`).set("Cookie", cookies[0])
      .send(changes).expect(200);
    expect(unchanged.body.meal).toEqual(expected);
    expect(await meals.list(userIds[0])).toContainEqual(expected);
  });

  it("keeps multiple meals on one date and returns them in calendar order", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    const later = await planMeal(recipe.id, "2027-11-08");
    const first = await planMeal(recipe.id, "2027-11-07");
    const second = await planMeal(recipe.id, "2027-11-07");
    const ids = [later.id, first.id, second.id];
    const listed = (await meals.list(userIds[0])).filter((meal) => ids.includes(meal.id));
    expect(listed).toEqual([first, second, later]);
  });

  it("isolates calendar entries and permits assigning only the owner's recipes", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    const otherRecipe = await recipes.create(userIds[1], sample);
    const meal = await planMeal(recipe.id, "2027-01-15");
    const otherList = await request(app).get("/api/meals").set("Cookie", cookies[1]).expect(200);
    expect(otherList.body.meals).not.toContainEqual(meal);

    await request(app).put(`/api/meals/${meal.id}`).set("Cookie", cookies[1])
      .send({ recipeId: otherRecipe.id, date: meal.date }).expect(404);
    await request(app).delete(`/api/meals/${meal.id}`).set("Cookie", cookies[1]).send({}).expect(404);
    await request(app).post("/api/meals").set("Cookie", cookies[0])
      .send({ recipeId: otherRecipe.id, date: meal.date }).expect(404);
    await request(app).put(`/api/meals/${meal.id}`).set("Cookie", cookies[0])
      .send({ recipeId: otherRecipe.id, date: meal.date }).expect(404);
    expect(await meals.list(userIds[0])).toContainEqual(meal);

    const spoofed = await request(app).post("/api/meals").set("Cookie", cookies[1])
      .send({ recipeId: otherRecipe.id, date: meal.date, userId: userIds[0] }).expect(201);
    expect(await meals.list(userIds[1])).toContainEqual(spoofed.body.meal);
    expect(await meals.list(userIds[0])).not.toContainEqual(spoofed.body.meal);
  });

  it("rejects a recipe removed after selection without changing the existing meal", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    const removed = await recipes.create(userIds[0], sample);
    const meal = await planMeal(recipe.id, "2027-04-05");
    await recipes.delete(userIds[0], removed.id);

    const staleSelection = { recipeId: removed.id, date: "2027-04-06" };
    await request(app).post("/api/meals").set("Cookie", cookies[0]).send(staleSelection).expect(404);
    await request(app).put(`/api/meals/${meal.id}`).set("Cookie", cookies[0]).send(staleSelection).expect(404);
    expect(await meals.list(userIds[0])).toContainEqual(meal);
  });

  it("shows the current recipe name after the recipe is edited", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    const meal = await planMeal(recipe.id, "2027-06-10");
    await recipes.update(userIds[0], recipe.id, { ...sample, name: "Red lentil soup" });
    expect(await meals.list(userIds[0])).toContainEqual({ ...meal, recipeName: "Red lentil soup" });
  });

  it("removes a calendar entry while preserving its source recipe", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    const meal = await planMeal(recipe.id, "2027-07-20");
    await request(app).delete(`/api/meals/${meal.id}`).set("Cookie", cookies[0]).send({}).expect(204);
    expect((await meals.list(userIds[0])).some((item) => item.id === meal.id)).toBe(false);
    expect(await recipes.find(userIds[0], recipe.id)).toEqual(recipe);
  });

  it("removes scheduled entries when their recipe is deleted", async () => {
    const recipe = await recipes.create(userIds[0], sample);
    await planMeal(recipe.id, "2027-08-01");
    await planMeal(recipe.id, "2027-08-02");
    await request(app).delete(`/api/recipes/${recipe.id}`).set("Cookie", cookies[0]).send({}).expect(204);

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM planned_meals WHERE recipe_id = ?", [recipe.id],
    );
    expect(rows[0].total).toBe(0);
    expect((await meals.list(userIds[0])).some((meal) => meal.recipeId === recipe.id)).toBe(false);
  });
});
