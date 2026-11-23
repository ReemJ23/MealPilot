import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface InventoryInput {
  name: string;
  quantity: number | null;
  unit: string;
}

export interface InventoryItem extends InventoryInput {
  id: number;
}

export interface InventoryStore {
  list(userId: number): Promise<InventoryItem[]>;
  create(userId: number, input: InventoryInput): Promise<InventoryItem>;
  update(userId: number, id: number, input: InventoryInput): Promise<InventoryItem | null>;
  delete(userId: number, id: number): Promise<boolean>;
}

type InventoryRow = RowDataPacket & Omit<InventoryItem, "quantity"> & { quantity: string | number | null };

export class InventoryRepository implements InventoryStore {
  constructor(private readonly pool: Pool) {}

  async list(userId: number): Promise<InventoryItem[]> {
    return this.read(userId);
  }

  async create(userId: number, input: InventoryInput): Promise<InventoryItem> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "INSERT INTO inventory_items (user_id, name, quantity, unit) VALUES (?, ?, ?, ?)",
      [userId, input.name, input.quantity, input.unit],
    );
    return { id: result.insertId, ...input };
  }

  async update(userId: number, id: number, input: InventoryInput): Promise<InventoryItem | null> {
    await this.pool.execute<ResultSetHeader>(
      "UPDATE inventory_items SET name = ?, quantity = ?, unit = ? WHERE id = ? AND user_id = ?",
      [input.name, input.quantity, input.unit, id, userId],
    );
    // Reading the owned row also treats an unchanged save as successful.
    const [item] = await this.read(userId, id);
    return item ?? null;
  }

  async delete(userId: number, id: number): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "DELETE FROM inventory_items WHERE id = ? AND user_id = ?", [id, userId],
    );
    return result.affectedRows > 0;
  }

  private async read(userId: number, id?: number): Promise<InventoryItem[]> {
    const filter = id === undefined ? "" : " AND id = ?";
    const values = id === undefined ? [userId] : [userId, id];
    const [rows] = await this.pool.execute<InventoryRow[]>(
      `SELECT id, name, quantity, unit FROM inventory_items WHERE user_id = ?${filter} ORDER BY name, id`,
      values,
    );
    // MySQL returns decimals as text. An unrecorded quantity must remain null, not zero.
    return rows.map((row) => ({ ...row, quantity: row.quantity === null ? null : Number(row.quantity) }));
  }
}
