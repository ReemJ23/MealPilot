import { Router } from "express";
import type { Request, Response } from "express";
import type { User } from "./AuthRepository.js";
import type { Ingredient, RecipeInput, RecipeStore } from "./RecipeRepository.js";

export class RecipeController {
  readonly router = Router();

  constructor(private readonly repository: RecipeStore) {
    this.router.get("/", this.list);
    this.router.get("/:id", this.find);
    this.router.post("/", this.create);
    this.router.put("/:id", this.update);
    this.router.delete("/:id", this.remove);
  }

  private list = async (_request: Request, response: Response): Promise<void> => {
    response.json({ recipes: await this.repository.list(this.userId(response)) });
  };

  private find = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    const recipe = await this.repository.find(this.userId(response), id);
    if (!recipe) {
      response.status(404).json({ message: "Recipe not found." });
      return;
    }
    response.json({ recipe });
  };

  private create = async (request: Request, response: Response): Promise<void> => {
    const input = this.readInput(request.body);
    if (typeof input === "string") {
      response.status(400).json({ message: input });
      return;
    }
    const recipe = await this.repository.create(this.userId(response), input);
    response.status(201).json({ recipe });
  };

  private update = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    const input = this.readInput(request.body);
    if (typeof input === "string") {
      response.status(400).json({ message: input });
      return;
    }
    const recipe = await this.repository.update(this.userId(response), id, input);
    if (!recipe) {
      response.status(404).json({ message: "Recipe not found." });
      return;
    }
    response.json({ recipe });
  };

  private remove = async (request: Request, response: Response): Promise<void> => {
    const id = this.readId(request, response);
    if (id === null) return;
    if (!await this.repository.delete(this.userId(response), id)) {
      response.status(404).json({ message: "Recipe not found." });
      return;
    }
    response.status(204).end();
  };

  private userId(response: Response): number {
    // Ownership always comes from the verified session, never the submitted form.
    return (response.locals.user as User).id;
  }

  private readId(request: Request, response: Response): number | null {
    const value = request.params.id;
    const id = Number(value);
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id) || id > 4_294_967_295) {
      response.status(400).json({ message: "Choose a valid recipe." });
      return null;
    }
    return id;
  }

  /** Return a useful validation message, or the fields that may be saved. */
  private readInput(value: unknown): RecipeInput | string {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return "Enter the recipe details.";
    const body = value as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    const { preparationTime, servings } = body;

    if (!name || name.length > 120) return "Enter a recipe name up to 120 characters.";
    if (!category || category.length > 50) return "Enter a category up to 50 characters.";
    if (!instructions || instructions.length > 10_000) return "Enter instructions up to 10000 characters.";
    if (typeof preparationTime !== "number" || !Number.isInteger(preparationTime) || preparationTime < 0 || preparationTime > 1440) {
      return "Preparation time must be a whole number from 0 to 1440 minutes.";
    }
    if (typeof servings !== "number" || !Number.isInteger(servings) || servings < 1 || servings > 100) {
      return "Servings must be a whole number from 1 to 100.";
    }
    if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > 50) {
      return "Add between 1 and 50 ingredients.";
    }

    const ingredients: Ingredient[] = [];
    for (const value of body.ingredients) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return "Enter valid ingredient details.";
      const ingredient = value as Record<string, unknown>;
      const ingredientName = typeof ingredient.name === "string" ? ingredient.name.trim() : "";
      const quantity = ingredient.quantity;
      const unit = ingredient.unit === undefined ? "" : ingredient.unit;
      if (!ingredientName || ingredientName.length > 100) return "Enter each ingredient name using up to 100 characters.";
      if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0.001 || quantity > 100_000 || Math.round(quantity * 1000) / 1000 !== quantity) {
        return "Ingredient quantities must be from 0.001 to 100000 with up to 3 decimal places.";
      }
      if (typeof unit !== "string" || unit.trim().length > 30) return "Ingredient units must be up to 30 characters.";
      ingredients.push({ name: ingredientName, quantity, unit: unit.trim() });
    }
    return { name, category, preparationTime, servings, instructions, ingredients };
  }
}
