import request from "supertest";
import { describe, expect, it } from "vitest";
import { Application } from "../src/Application.js";

const application = new Application();

describe("MealPilot API", () => {
  it("returns a successful health response", async () => {
    const response = await request(application.app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "mealpilot-api" });
  });

  it("returns 404 for an unknown route", async () => {
    const response = await request(application.app).get("/api/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Route not found" });
  });
});
