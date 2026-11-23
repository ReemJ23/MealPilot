import { Router } from "express";
import type { Request, Response } from "express";
import type { User } from "./AuthRepository.js";
import type { MealInput, MealPlanStore } from "./MealPlanRepository.js";

export class MealPlanController {
  readonly router = Router();

  constructor(private readonly repository: MealPlanStore) {
    this.router.get("/", this.list);
    this.router.post("/", this.create);
    this.router.put("/:id", this.update);
    this.router.delete("/:id", this.remove);
  }

  private list = async (_request: Request, response: Response): Promise<void> => {
    response.json({ meals: await this.repository.list(this.userId(response)) });
  };

  private create = async (request: Request, response: Response): Promise<void> => {
    const input = this.readInput(request.body);
    if (typeof input === "string") {
      response.status(400).json({ message: input });
      return;
    }
    const meal = await this.repository.create(this.userId(response), input);
    if (!meal) {
      response.status(404).json({ message: "Recipe not found." });
      return;
    }
    response.status(201).json({ meal });
  };

  private update = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    const input = this.readInput(request.body);
    if (typeof input === "string") {
      response.status(400).json({ message: input });
      return;
    }
    const meal = await this.repository.update(this.userId(response), id, input);
    if (!meal) {
      response.status(404).json({ message: "Planned meal or recipe not found." });
      return;
    }
    response.json({ meal });
  };

  private remove = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    if (!await this.repository.delete(this.userId(response), id)) {
      response.status(404).json({ message: "Planned meal not found." });
      return;
    }
    response.status(204).end();
  };

  private userId(response: Response): number {
    // Submitted user IDs never decide whose calendar is read or changed.
    return (response.locals.user as User).id;
  }

  private readId(request: Request, response: Response): number | null {
    const value = request.params.id;
    const id = Number(value);
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 4_294_967_295) {
      response.status(400).json({ message: "Choose a valid planned meal." });
      return null;
    }
    return id;
  }

  private readInput(value: unknown): MealInput | string {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Choose a recipe and date.";
    const { recipeId, date } = value as Record<string, unknown>;
    if (typeof recipeId !== "number" || !Number.isInteger(recipeId) || recipeId < 1 || recipeId > 4_294_967_295) {
      return "Choose a valid recipe.";
    }
    if (typeof date !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) return "Choose a valid calendar date.";
    // Round-trip through UTC to reject impossible dates without applying a local offset.
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      return "Choose a valid calendar date.";
    }
    return { recipeId, date };
  }
}
