import express from "express";
import type { Express } from "express";

/** Keep application construction separate from opening a network port. */
export class Application {
  readonly app: Express;

  constructor() {
    this.app = express();
    this.app.disable("x-powered-by");

    // The frontend uses this route to check its connection to the backend.
    this.app.get("/api/health", (_request, response) => {
      response.json({ status: "ok", service: "mealpilot-api" });
    });

    this.app.use((_request, response) => {
      response.status(404).json({ message: "Route not found" });
    });
  }
}
