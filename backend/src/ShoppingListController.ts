import { Router } from "express";
import type { Request, Response } from "express";
import type { User } from "./AuthRepository.js";
import { MAX_SHOPPING_QUANTITY } from "./ShoppingListBuilder.js";
import type { ShoppingInput, ShoppingListStore, ShoppingPeriod } from "./ShoppingListRepository.js";

export class ShoppingListController {
  readonly router = Router();

  constructor(private readonly repository: ShoppingListStore) {
    this.router.get("/", this.list);
    this.router.post("/", this.create);
    this.router.post("/preview", this.preview);
    this.router.post("/generate", this.generate);
    this.router.put("/:id", this.update);
    this.router.patch("/:id", this.setPurchased);
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
    response.status(201).json({ item: await this.repository.create(this.userId(response), input) });
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
      response.status(404).json({ message: "Shopping item not found." });
      return;
    }
    response.json({ item });
  };

  private setPurchased = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    const value = request.body as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || !("purchased" in value) || typeof value.purchased !== "boolean") {
      response.status(400).json({ message: "Choose whether the item has been purchased." });
      return;
    }
    const item = await this.repository.setPurchased(this.userId(response), id, value.purchased);
    if (!item) {
      response.status(404).json({ message: "Shopping item not found." });
      return;
    }
    response.json({ item });
  };

  private remove = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    if (!await this.repository.delete(this.userId(response), id)) {
      response.status(404).json({ message: "Shopping item not found." });
      return;
    }
    response.status(204).end();
  };

  private preview = async (request: Request, response: Response): Promise<void> => {
    const period = this.readPeriod(request.body);
    if (typeof period === "string") {
      response.status(400).json({ message: period });
      return;
    }
    try {
      response.json(await this.repository.preview(this.userId(response), period));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      response.status(400).json({ message: error.message });
    }
  };

  private generate = async (request: Request, response: Response): Promise<void> => {
    const period = this.readPeriod(request.body);
    if (typeof period === "string") {
      response.status(400).json({ message: period });
      return;
    }
    const { selectedKeys } = request.body as Record<string, unknown>;
    if (!Array.isArray(selectedKeys) || selectedKeys.length === 0 || selectedKeys.some((key) => typeof key !== "string")) {
      response.status(400).json({ message: "Select at least one missing ingredient." });
      return;
    }
    try {
      response.json(await this.repository.generate(this.userId(response), period, [...new Set(selectedKeys)]));
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      response.status(400).json({ message: error.message });
    }
  };

  private userId(response: Response): number {
    // Ownership always comes from the signed-in account.
    return (response.locals.user as User).id;
  }

  private readId(request: Request, response: Response): number | null {
    const value = request.params.id;
    const id = Number(value);
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 4_294_967_295) {
      response.status(400).json({ message: "Choose a valid shopping item." });
      return null;
    }
    return id;
  }

  private readInput(value: unknown): ShoppingInput | string {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Enter an item name.";
    const input = value as Record<string, unknown>;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > 100) return "Enter an item name of 1 to 100 characters.";
    const unit = input.unit === undefined ? "" : typeof input.unit === "string" ? input.unit.trim() : null;
    if (unit === null || unit.length > 30) return "Use a unit of up to 30 characters, or leave it blank.";
    const quantity = input.quantity ?? null;
    if (quantity !== null && (typeof quantity !== "number" || !Number.isFinite(quantity)
      || quantity < 0.001 || quantity > MAX_SHOPPING_QUANTITY || Math.round(quantity * 1000) / 1000 !== quantity)) {
      return "Enter a quantity from 0.001 to 9999999999.999 with up to 3 decimal places, or leave it blank.";
    }
    return { name, quantity, unit };
  }

  private readPeriod(value: unknown): ShoppingPeriod | string {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Choose a start date and end date.";
    const { startDate, endDate } = value as Record<string, unknown>;
    if (!this.isDate(startDate) || !this.isDate(endDate)) return "Choose valid start and end dates.";
    if (endDate < startDate) return "The end date must be on or after the start date.";
    return { startDate, endDate };
  }

  private isDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
    // UTC round-tripping rejects impossible dates without shifting the chosen day.
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
}
