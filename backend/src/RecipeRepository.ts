import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
}

export interface RecipeInput {
  name: string;
  category: string;
  preparationTime: number;
  servings: number;
  instructions: string;
  ingredients: Ingredient[];
}

export interface Recipe extends RecipeInput {
  id: number;
}

export type RecipeSummary = Omit<Recipe, "instructions" | "ingredients">;

type RecipeRow = Omit<Recipe, "ingredients"> & RowDataPacket & {
  ingredientName: string | null;
  ingredientQuantity: string | null;
  ingredientUnit: string | null;
};

export interface RecipeStore {
  list(userId: number): Promise<RecipeSummary[]>;
  find(userId: number, id: number): Promise<Recipe | null>;
  create(userId: number, input: RecipeInput): Promise<Recipe>;
  update(userId: number, id: number, input: RecipeInput): Promise<Recipe | null>;
  delete(userId: number, id: number): Promise<boolean>;
}

export class RecipeRepository implements RecipeStore {
  constructor(private readonly pool: Pool) {}

  async list(userId: number): Promise<RecipeSummary[]> {
    const [rows] = await this.pool.execute<(RecipeSummary & RowDataPacket)[]>(
      `SELECT id, name, category, preparation_minutes AS preparationTime, servings
       FROM recipes WHERE user_id = ? ORDER BY id DESC`,
      [userId],
    );
    return rows;
  }

  async find(userId: number, id: number): Promise<Recipe | null> {
    // One query keeps the recipe and ingredients consistent during concurrent edits.
    const [rows] = await this.pool.execute<RecipeRow[]>(
      `SELECT recipes.id, recipes.name, recipes.category,
              recipes.preparation_minutes AS preparationTime, recipes.servings, recipes.instructions,
              ingredients.name AS ingredientName, ingredients.quantity AS ingredientQuantity,
              ingredients.unit AS ingredientUnit
       FROM recipes LEFT JOIN recipe_ingredients AS ingredients ON ingredients.recipe_id = recipes.id
       WHERE recipes.user_id = ? AND recipes.id = ? ORDER BY ingredients.sort_order`,
      [userId, id],
    );
    const recipe = rows[0];
    if (!recipe) return null;
    const ingredients: Ingredient[] = [];
    for (const row of rows) {
      if (row.ingredientName !== null) {
        // MySQL returns DECIMAL values as strings; the API uses numeric quantities.
        ingredients.push({ name: row.ingredientName, quantity: Number(row.ingredientQuantity), unit: row.ingredientUnit ?? "" });
      }
    }
    return {
      id: recipe.id, name: recipe.name, category: recipe.category,
      preparationTime: recipe.preparationTime, servings: recipe.servings,
      instructions: recipe.instructions, ingredients,
    };
  }

  async create(userId: number, input: RecipeInput): Promise<Recipe> {
    const connection = await this.pool.getConnection();
    try {
      // Save the recipe and every ingredient together, or roll back the entire change.
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO recipes (user_id, name, category, preparation_minutes, servings, instructions)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, input.name, input.category, input.preparationTime, input.servings, input.instructions],
      );
      await this.saveIngredients(connection, result.insertId, input.ingredients);
      await connection.commit();
      return { ...input, id: result.insertId };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async update(userId: number, id: number, input: RecipeInput): Promise<Recipe | null> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Lock the owned recipe before replacing its ingredients.
      const [owned] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM recipes WHERE user_id = ? AND id = ? FOR UPDATE", [userId, id],
      );
      if (!owned[0]) {
        await connection.rollback();
        return null;
      }
      await connection.execute(
        `UPDATE recipes SET name = ?, category = ?, preparation_minutes = ?, servings = ?, instructions = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND id = ?`,
        [input.name, input.category, input.preparationTime, input.servings, input.instructions, userId, id],
      );
      await connection.execute("DELETE FROM recipe_ingredients WHERE recipe_id = ?", [id]);
      await this.saveIngredients(connection, id, input.ingredients);
      await connection.commit();
      return { ...input, id };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async delete(userId: number, id: number): Promise<boolean> {
    // The foreign key removes ingredients only when their owned recipe is deleted.
    const [result] = await this.pool.execute<ResultSetHeader>(
      "DELETE FROM recipes WHERE user_id = ? AND id = ?", [userId, id],
    );
    return result.affectedRows > 0;
  }

  private async saveIngredients(connection: PoolConnection, id: number, ingredients: Ingredient[]): Promise<void> {
    for (const [position, ingredient] of ingredients.entries()) {
      await connection.execute(
        "INSERT INTO recipe_ingredients (recipe_id, sort_order, name, quantity, unit) VALUES (?, ?, ?, ?, ?)",
        [id, position, ingredient.name, ingredient.quantity, ingredient.unit],
      );
    }
  }
}
