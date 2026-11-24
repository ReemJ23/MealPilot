import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type { Ingredient } from "./RecipeRepository.js";
import type { InventoryInput } from "./InventoryRepository.js";
import { MAX_SHOPPING_THOUSANDTHS, ShoppingListBuilder } from "./ShoppingListBuilder.js";
import type { ShoppingSuggestion } from "./ShoppingListBuilder.js";

export interface ShoppingInput {
  name: string;
  quantity: number | null;
  unit: string;
}

export interface ShoppingItem extends ShoppingInput {
  id: number;
  purchased: boolean;
}

export interface ShoppingPeriod {
  startDate: string;
  endDate: string;
}

export interface ShoppingPreview {
  mealCount: number;
  suggestions: ShoppingSuggestion[];
}

export interface ShoppingGeneration {
  items: ShoppingItem[];
  addedCount: number;
}

export interface ShoppingListStore {
  list(userId: number): Promise<ShoppingItem[]>;
  create(userId: number, input: ShoppingInput): Promise<ShoppingItem>;
  update(userId: number, id: number, input: ShoppingInput): Promise<ShoppingItem | null>;
  setPurchased(userId: number, id: number, purchased: boolean): Promise<ShoppingItem | null>;
  delete(userId: number, id: number): Promise<boolean>;
  preview(userId: number, period: ShoppingPeriod): Promise<ShoppingPreview>;
  generate(userId: number, period: ShoppingPeriod, selectedKeys: string[]): Promise<ShoppingGeneration>;
}

type ShoppingRow = RowDataPacket & Omit<ShoppingItem, "quantity" | "purchased"> & {
  quantity: string | number | null;
  purchased: number;
};
type RequiredRow = RowDataPacket & {
  mealId: number;
  name: string | null;
  quantity: string | number | null;
  unit: string | null;
};
type InventoryRow = RowDataPacket & Omit<InventoryInput, "quantity"> & { quantity: string | number | null };

export class ShoppingListRepository implements ShoppingListStore {
  private readonly builder = new ShoppingListBuilder();

  constructor(private readonly pool: Pool) {}

  async list(userId: number): Promise<ShoppingItem[]> {
    return this.readItems(this.pool, userId);
  }

  async create(userId: number, input: ShoppingInput): Promise<ShoppingItem> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "INSERT INTO shopping_items (user_id, name, quantity, unit) VALUES (?, ?, ?, ?)",
      [userId, input.name, input.quantity, input.unit],
    );
    return { id: result.insertId, ...input, purchased: false };
  }

  async update(userId: number, id: number, input: ShoppingInput): Promise<ShoppingItem | null> {
    await this.pool.execute<ResultSetHeader>(
      "UPDATE shopping_items SET name = ?, quantity = ?, unit = ? WHERE id = ? AND user_id = ?",
      [input.name, input.quantity, input.unit, id, userId],
    );
    // Reading the row makes an unchanged save successful too.
    const [item] = await this.readItems(this.pool, userId, id);
    return item ?? null;
  }

  async setPurchased(userId: number, id: number, purchased: boolean): Promise<ShoppingItem | null> {
    await this.pool.execute<ResultSetHeader>(
      "UPDATE shopping_items SET purchased = ? WHERE id = ? AND user_id = ?", [purchased, id, userId],
    );
    const [item] = await this.readItems(this.pool, userId, id);
    return item ?? null;
  }

  async delete(userId: number, id: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "DELETE FROM shopping_items WHERE id = ? AND user_id = ?", [id, userId],
    );
    return result.affectedRows > 0;
  }

  async preview(userId: number, period: ShoppingPeriod): Promise<ShoppingPreview> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // All inputs come from one snapshot of the user's saved data.
      const items = await this.readItems(connection, userId);
      const preview = await this.calculate(connection, userId, period, items);
      await connection.commit();
      return preview;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async generate(userId: number, period: ShoppingPeriod, selectedKeys: string[]): Promise<ShoppingGeneration> {
    let retriesRemaining = 2;
    while (true) {
      try {
        return await this.generateTransaction(userId, period, selectedKeys);
      } catch (error) {
        if (retriesRemaining === 0 || typeof error !== "object" || error === null
          || !("code" in error) || error.code !== "ER_LOCK_DEADLOCK") throw error;
        // Different empty lists can share an InnoDB gap lock. Retry only after rollback and release.
        retriesRemaining--;
      }
    }
  }

  private async generateTransaction(userId: number, period: ShoppingPeriod, selectedKeys: string[]): Promise<ShoppingGeneration> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Serialize generation for one account so repeated requests cannot add twice.
      await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
      // Lock the current rows before taking a snapshot, preserving concurrent manual edits.
      const items = await this.readItems(connection, userId, undefined, true);
      const preview = await this.calculate(connection, userId, period, items);
      const selected = new Set(selectedKeys);
      let addedCount = 0;
      for (const suggestion of preview.suggestions) {
        if (!selected.has(suggestion.key)) continue;
        const existing = items.find((item) => !item.purchased && item.quantity !== null
          && ShoppingListBuilder.key(item.name, item.unit) === suggestion.key);
        if (existing && existing.quantity !== null) {
          const total = Math.round(existing.quantity * 1000) + Math.round(suggestion.quantity * 1000);
          if (!Number.isSafeInteger(total) || total > MAX_SHOPPING_THOUSANDTHS) {
            throw new RangeError("The combined shopping quantity is too large. Choose a shorter date range.");
          }
          await connection.execute(
            "UPDATE shopping_items SET quantity = ? WHERE id = ? AND user_id = ?",
            [total / 1000, existing.id, userId],
          );
        } else {
          // Unknown amounts remain unchanged. The new row records only the calculated shortage.
          await connection.execute(
            "INSERT INTO shopping_items (user_id, name, quantity, unit) VALUES (?, ?, ?, ?)",
            [userId, suggestion.name, suggestion.quantity, suggestion.unit],
          );
        }
        addedCount++;
      }
      const result = { items: await this.readItems(connection, userId, undefined, true), addedCount };
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async readItems(connection: Pool | PoolConnection, userId: number, id?: number, lock = false): Promise<ShoppingItem[]> {
    const filter = id === undefined ? "" : " AND id = ?";
    const values = id === undefined ? [userId] : [userId, id];
    const [rows] = await connection.execute<ShoppingRow[]>(
      `SELECT id, name, quantity, unit, purchased FROM shopping_items WHERE user_id = ?${filter}
       ORDER BY purchased, name, id${lock ? " FOR UPDATE" : ""}`, values,
    );
    return rows.map((row) => ({
      ...row, quantity: row.quantity === null ? null : Number(row.quantity), purchased: Boolean(row.purchased),
    }));
  }

  private async calculate(connection: PoolConnection, userId: number, period: ShoppingPeriod, items: ShoppingItem[]): Promise<ShoppingPreview> {
    const [rows] = await connection.execute<RequiredRow[]>(
      `SELECT planned.id AS mealId, ingredients.name, ingredients.quantity, ingredients.unit
       FROM planned_meals AS planned
       JOIN recipes AS recipe ON recipe.id = planned.recipe_id AND recipe.user_id = planned.user_id
       LEFT JOIN recipe_ingredients AS ingredients ON ingredients.recipe_id = recipe.id
       WHERE planned.user_id = ? AND planned.planned_date BETWEEN ? AND ?
       ORDER BY planned.planned_date, planned.id, ingredients.sort_order`,
      [userId, period.startDate, period.endDate],
    );
    const required: Ingredient[] = rows.map((row) => {
      if (row.name === null || row.quantity === null || row.unit === null) {
        throw new Error("A planned recipe has no ingredients.");
      }
      return { name: row.name, quantity: Number(row.quantity), unit: row.unit };
    });
    const [stock] = await connection.execute<InventoryRow[]>(
      "SELECT name, quantity, unit FROM inventory_items WHERE user_id = ? ORDER BY id", [userId],
    );
    const inventory = stock.map((row) => ({ ...row, quantity: row.quantity === null ? null : Number(row.quantity) }));
    return { mealCount: new Set(rows.map((row) => row.mealId)).size, suggestions: this.builder.build(required, inventory, items) };
  }
}
