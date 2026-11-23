import express from "express";
import type { ErrorRequestHandler, Express } from "express";
import { AuthController } from "./AuthController.js";
import type { AccountStore } from "./AuthRepository.js";

/** Keep application construction separate from opening a network port. */
export class Application {
  readonly app: Express;
  readonly auth: AuthController;

  constructor(repository: AccountStore, options: { origin?: string; secureCookies?: boolean } = {}) {
    this.app = express();
    this.app.disable("x-powered-by");
    this.auth = new AuthController(
      repository,
      options.origin ?? "http://127.0.0.1:5173",
      options.secureCookies ?? false,
    );

    // A simple health endpoint remains useful for deployment checks.
    this.app.get("/api/health", (_request, response) => {
      response.json({ status: "ok", service: "mealpilot-api" });
    });
    this.app.use("/api/auth", this.auth.router);

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
