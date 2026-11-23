import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface MealInput {
  recipeId: number;
  date: string;
}

export interface PlannedMeal extends MealInput {
  id: number;
  recipeName: string;
}

export interface MealPlanStore {
  list(userId: number): Promise<PlannedMeal[]>;
  create(userId: number, input: MealInput): Promise<PlannedMeal | null>;
  update(userId: number, id: number, input: MealInput): Promise<PlannedMeal | null>;
  delete(userId: number, id: number): Promise<boolean>;
}

export class MealPlanRepository implements MealPlanStore {
  constructor(private readonly pool: Pool) {}

  async list(userId: number): Promise<PlannedMeal[]> {
    return this.read(userId);
  }

  async create(userId: number, input: MealInput): Promise<PlannedMeal | null> {
    // Check recipe ownership in the same statement that creates the calendar entry.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO planned_meals (user_id, recipe_id, planned_date)
       SELECT user_id, id, ? FROM recipes WHERE id = ? AND user_id = ?`,
      [input.date, input.recipeId, userId],
    );
    if (!result.affectedRows) return null;
    const [meal] = await this.read(userId, result.insertId);
    return meal ?? null;
  }

  async update(userId: number, id: number, input: MealInput): Promise<PlannedMeal | null> {
    // Both the calendar entry and the replacement recipe must belong to this user.
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE planned_meals AS meals
       JOIN recipes ON recipes.id = ? AND recipes.user_id = ?
       SET meals.recipe_id = recipes.id, meals.planned_date = ?
       WHERE meals.id = ? AND meals.user_id = ?`,
      [input.recipeId, userId, input.date, id, userId],
    );
    const [meal] = await this.read(userId, id);
    if (!meal) return null;
    // Saving an unchanged meal is still successful when a driver counts only changed rows.
    if (!result.affectedRows && (meal.recipeId !== input.recipeId || meal.date !== input.date)) return null;
    return meal;
  }

  async delete(userId: number, id: number): Promise<boolean> {
    // Removing a calendar entry leaves the saved recipe available for another day.
    const [result] = await this.pool.execute<ResultSetHeader>(
      "DELETE FROM planned_meals WHERE id = ? AND user_id = ?", [id, userId],
    );
    return result.affectedRows > 0;
  }

  private async read(userId: number, id?: number): Promise<PlannedMeal[]> {
    const filter = id === undefined ? "" : " AND meals.id = ?";
    const values = id === undefined ? [userId, userId] : [userId, userId, id];
    // A SQL date is returned as text so time zones cannot move a meal to another day.
    const [rows] = await this.pool.execute<(PlannedMeal & RowDataPacket)[]>(
      `SELECT meals.id, meals.recipe_id AS recipeId, recipes.name AS recipeName,
              DATE_FORMAT(meals.planned_date, '%Y-%m-%d') AS date
       FROM planned_meals AS meals JOIN recipes ON recipes.id = meals.recipe_id
       WHERE meals.user_id = ? AND recipes.user_id = ?${filter}
       ORDER BY meals.planned_date, meals.id`,
      values,
    );
    return rows;
  }
}
