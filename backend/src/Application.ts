import express from "express";
import type { ErrorRequestHandler, Express } from "express";
import { AuthController } from "./AuthController.js";
import type { AccountStore } from "./AuthRepository.js";
import { RecipeController } from "./RecipeController.js";
import type { RecipeStore } from "./RecipeRepository.js";
import { MealPlanController } from "./MealPlanController.js";
import type { MealPlanStore } from "./MealPlanRepository.js";
import { InventoryController } from "./InventoryController.js";
import type { InventoryStore } from "./InventoryRepository.js";

/** Keep application construction separate from opening a network port. */
export class Application {
  readonly app: Express;
  readonly auth: AuthController;

  constructor(repository: AccountStore, options: {
    origin?: string; secureCookies?: boolean; recipes?: RecipeStore; meals?: MealPlanStore; inventory?: InventoryStore;
  } = {}) {
    this.app = express();
    this.app.disable("x-powered-by");
    this.auth = new AuthController(repository, options.secureCookies ?? false);

    // The same browser-write checks apply to accounts and all personal data.
    const origin = options.origin ?? "http://127.0.0.1:5173";
    this.app.use("/api", (request, response, next) => {
      response.set("Cache-Control", "no-store");
      if (request.method !== "GET" && request.method !== "HEAD") {
        if (request.get("origin") && request.get("origin") !== origin) {
          response.status(403).json({ message: "This request is not allowed." });
          return;
        }
        if (!request.is("application/json")) {
          response.status(415).json({ message: "Send the request as JSON." });
          return;
        }
      }
      next();
    });
    this.app.use("/api", express.json({ limit: "64kb" }));

    // A simple health endpoint remains useful for deployment checks.
    this.app.get("/api/health", (_request, response) => {
      response.json({ status: "ok", service: "mealpilot-api" });
    });
    this.app.use("/api/auth", this.auth.router);
    if (options.recipes) {
      this.app.use("/api/recipes", this.auth.requireUser, new RecipeController(options.recipes).router);
    }
    if (options.meals) {
      this.app.use("/api/meals", this.auth.requireUser, new MealPlanController(options.meals).router);
    }
    if (options.inventory) {
      this.app.use("/api/inventory", this.auth.requireUser, new InventoryController(options.inventory).router);
    }

    this.app.use((_request, response) => {
      response.status(404).json({ message: "Route not found" });
    });

    // Express forwards rejected asynchronous route handlers here.
    const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
      if (response.headersSent) {
        next(error);
        return;
      }
      const status = typeof error === "object" && error !== null && "status" in error ? error.status : 500;
      if (status === 400 || status === 413) {
        response.status(status).json({ message: status === 413 ? "The request is too large." : "Send valid JSON." });
        return;
      }
      console.error("Request failed", error instanceof Error ? error.message : "Unknown error");
      response.status(500).json({ message: "Something went wrong. Please try again." });
    };
    this.app.use(handleError);
  }
}
