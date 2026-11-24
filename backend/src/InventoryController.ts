import { Router } from "express";
import type { Request, Response } from "express";
import type { User } from "./AuthRepository.js";
import type { InventoryInput, InventoryStore } from "./InventoryRepository.js";

export class InventoryController {
  readonly router = Router();

  constructor(private readonly repository: InventoryStore) {
    this.router.get("/", this.list);
    this.router.post("/", this.create);
    this.router.put("/:id", this.update);
    this.router.delete("/:id", this.remove);
  }

  private list = async (_request: Request, response: Response): Promise<void> => {
    response.json({ items: await this.repository.list(this.userId(response)) });
  };

  private create = async (request: Request, response: Response): Promise<void> => {
    const input = this.readInput(request.body);
    if (typeof input === "string") {
      response.status(400).json({ message: input });
      return;
    }
    const item = await this.repository.create(this.userId(response), input);
    response.status(201).json({ item });
  };

  private update = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    const input = this.readInput(request.body);
    if (typeof input === "string") {
      response.status(400).json({ message: input });
      return;
    }
    const item = await this.repository.update(this.userId(response), id, input);
    if (!item) {
      response.status(404).json({ message: "Inventory item not found." });
      return;
    }
    response.json({ item });
  };

  private remove = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    if (!await this.repository.delete(this.userId(response), id)) {
      response.status(404).json({ message: "Inventory item not found." });
      return;
    }
    response.status(204).end();
  };

  private userId(response: Response): number {
    // Inventory ownership comes only from the verified session.
    return (response.locals.user as User).id;
  }

  private readId(request: Request, response: Response): number | null {
    const value = request.params.id;
    const id = Number(value);
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 4_294_967_295) {
      response.status(400).json({ message: "Choose a valid inventory item." });
      return null;
    }
    return id;
  }

  private readInput(value: unknown): InventoryInput | string {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Enter the ingredient details.";
    const body = value as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const quantity = body.quantity === undefined ? null : body.quantity;
    const unit = body.unit === undefined ? "" : body.unit;
    if (!name || name.length > 100) return "Enter an ingredient name up to 100 characters.";
    // Blank means the amount is unknown. Zero is a valid recorded amount.
    if (quantity !== null && (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0 || quantity > 100_000 || Math.round(quantity * 1000) / 1000 !== quantity)) {
      return "Quantity must be from 0 to 100000 with up to 3 decimal places, or left blank.";
    }
    if (typeof unit !== "string" || unit.trim().length > 30) return "Enter a unit up to 30 characters, or leave it blank.";
    return { name, quantity, unit: unit.trim() };
  }
}
