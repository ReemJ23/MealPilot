import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import type { AccountStore } from "../src/AuthRepository.js";
import type { InventoryInput, InventoryItem, InventoryStore } from "../src/InventoryRepository.js";

/** Route tests cover the HTTP contract. Database tests verify the SQL separately. */
class MemoryInventoryStore implements InventoryStore {
  private readonly records = new Map<number, { ownerId: number; item: InventoryItem }>();
  private nextId = 1;

  async list(userId: number): Promise<InventoryItem[]> {
    return [...this.records.values()].filter((record) => record.ownerId === userId)
      .map(({ item }) => ({ ...item })).sort((first, second) => first.name.localeCompare(second.name) || first.id - second.id);
  }

  async create(userId: number, input: InventoryInput): Promise<InventoryItem> {
    const item = { ...input, id: this.nextId++ };
    this.records.set(item.id, { ownerId: userId, item });
    return { ...item };
  }

  async update(userId: number, id: number, input: InventoryInput): Promise<InventoryItem | null> {
    if (this.records.get(id)?.ownerId !== userId) return null;
    const item = { ...input, id };
    this.records.set(id, { ownerId: userId, item });
    return { ...item };
  }

  async delete(userId: number, id: number): Promise<boolean> {
    if (this.records.get(id)?.ownerId !== userId) return false;
    return this.records.delete(id);
  }
}

const firstToken = "a".repeat(64);
const secondToken = "b".repeat(64);
const firstCookie = `mealpilot_session=${firstToken}`;
const secondCookie = `mealpilot_session=${secondToken}`;
const sessions = new Map([
  [createHash("sha256").update(firstToken).digest("hex"), { id: 1, name: "Reem", email: "reem@example.com" }],
  [createHash("sha256").update(secondToken).digest("hex"), { id: 2, name: "Second user", email: "second@example.com" }],
]);
const input: InventoryInput = { name: "Rice", quantity: 1.5, unit: "kg" };
let inventory: MemoryInventoryStore;
let app: Application["app"];

beforeEach(() => {
  inventory = new MemoryInventoryStore();
  const accounts: AccountStore = {
    createUser: vi.fn(), findUserByEmail: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(),
    findUserBySession: async (hash) => sessions.get(hash) ?? null,
  };
  app = new Application(accounts, { inventory }).app;
});

describe("Kitchen inventory API", () => {
  it("creates a trimmed item owned by the signed-in user", async () => {
    const response = await request(app).post("/api/inventory").set("Cookie", firstCookie)
      .send({ ...input, name: " Rice ", unit: " kg ", userId: 2, id: 99 });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item: { id: 1, ...input } });
    expect(await inventory.list(1)).toEqual([response.body.item]);
    expect(await inventory.list(2)).toEqual([]);
  });

  it("accepts an ingredient without a quantity or unit", async () => {
    const response = await request(app).post("/api/inventory").set("Cookie", firstCookie).send({ name: "Salt" });
    expect(response.status).toBe(201);
    expect(response.body.item).toEqual({ id: 1, name: "Salt", quantity: null, unit: "" });
  });

  it("accepts an explicit unknown quantity while retaining the optional unit", async () => {
    const response = await request(app).post("/api/inventory").set("Cookie", firstCookie)
      .send({ name: "Flour", quantity: null, unit: "g" });
    expect(response.status).toBe(201);
    expect(response.body.item).toEqual({ id: 1, name: "Flour", quantity: null, unit: "g" });
  });

  it("preserves zero and supported decimal quantities", async () => {
    for (const quantity of [0, 0.001, 0.125, 100_000]) {
      const response = await request(app).post("/api/inventory").set("Cookie", firstCookie).send({ ...input, quantity });
      expect(response.status).toBe(201);
      expect(response.body.item.quantity).toBe(quantity);
    }
  });

  it("lists only owned items in alphabetical order", async () => {
    const rice = await inventory.create(1, input);
    await inventory.create(2, { ...input, name: "Private ingredient" });
    const beans = await inventory.create(1, { name: "Beans", quantity: null, unit: "" });
    const response = await request(app).get("/api/inventory").set("Cookie", firstCookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [beans, rice] });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("updates the ingredient and allows a recorded quantity to be cleared", async () => {
    const item = await inventory.create(1, input);
    const changed = { name: "Brown rice", quantity: 0, unit: "cup" };
    await request(app).put(`/api/inventory/${item.id}`).set("Cookie", firstCookie)
      .send({ ...changed, userId: 2 }).expect(200, { item: { id: item.id, ...changed } });
    const response = await request(app).put(`/api/inventory/${item.id}`).set("Cookie", firstCookie)
      .send({ name: changed.name, quantity: null });
    expect(response.status).toBe(200);
    expect(response.body.item).toEqual({ id: item.id, name: changed.name, quantity: null, unit: "" });
    expect(await inventory.list(1)).toEqual([response.body.item]);
    expect(await inventory.list(2)).toEqual([]);
  });

  it("removes an owned item and returns an empty response", async () => {
    const item = await inventory.create(1, input);
    const response = await request(app).delete(`/api/inventory/${item.id}`).set("Cookie", firstCookie).send({});
    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(await inventory.list(1)).toEqual([]);
  });

  it("requires a session for every inventory operation", async () => {
    await request(app).get("/api/inventory").expect(401);
    await request(app).post("/api/inventory").send(input).expect(401);
    await request(app).put("/api/inventory/1").send(input).expect(401);
    await request(app).delete("/api/inventory/1").send({}).expect(401);
  });

  it("treats missing and another user's items alike without changing them", async () => {
    const item = await inventory.create(1, input);
    for (const id of [item.id, 999]) {
      await request(app).put(`/api/inventory/${id}`).set("Cookie", secondCookie)
        .send({ ...input, name: "Changed" }).expect(404, { message: "Inventory item not found." });
      await request(app).delete(`/api/inventory/${id}`).set("Cookie", secondCookie).send({})
        .expect(404, { message: "Inventory item not found." });
    }
    expect(await inventory.list(1)).toEqual([item]);
  });

  it("rejects invalid item IDs before changing the inventory", async () => {
    for (const id of ["0", "-1", "1.5", "abc", "1e2", "4294967296"]) {
      await request(app).put(`/api/inventory/${id}`).set("Cookie", firstCookie).send(input).expect(400);
      await request(app).delete(`/api/inventory/${id}`).set("Cookie", firstCookie).send({}).expect(400);
    }
  });

  it.each([
    ["blank name", { name: " " }],
    ["long name", { name: "a".repeat(101) }],
    ["invalid name type", { name: 123 }],
    ["negative quantity", { quantity: -1 }],
    ["quantity above the limit", { quantity: 100_000.001 }],
    ["excess quantity precision", { quantity: 0.1234 }],
    ["numeric string quantity", { quantity: "2" }],
    ["empty string quantity", { quantity: "" }],
    ["boolean quantity", { quantity: false }],
    ["invalid unit type", { unit: null }],
    ["long unit", { unit: "a".repeat(31) }],
  ])("rejects %s without adding an item", async (_label, invalid) => {
    const response = await request(app).post("/api/inventory").set("Cookie", firstCookie).send({ ...input, ...invalid });
    expect(response.status).toBe(400);
    expect(response.body.message).toBeTypeOf("string");
    expect(await inventory.list(1)).toEqual([]);
  });

  it("rejects incomplete objects and non-finite quantities", async () => {
    for (const body of [{}, []]) {
      await request(app).post("/api/inventory").set("Cookie", firstCookie).send(body).expect(400);
    }
    await request(app).post("/api/inventory").set("Cookie", firstCookie).type("json")
      .send('{"name":"Rice","quantity":1e309}').expect(400);
    expect(await inventory.list(1)).toEqual([]);
  });

  it("keeps an existing item after an invalid update", async () => {
    const item = await inventory.create(1, input);
    await request(app).put(`/api/inventory/${item.id}`).set("Cookie", firstCookie)
      .send({ ...input, quantity: -1 }).expect(400);
    expect(await inventory.list(1)).toEqual([item]);
  });

  it("applies the shared origin and JSON checks to inventory writes", async () => {
    await request(app).post("/api/inventory").set("Cookie", firstCookie)
      .set("Origin", "https://another-site.example").send(input).expect(403);
    await request(app).delete("/api/inventory/1").set("Cookie", firstCookie).type("form").send("ignored=value").expect(415);
    await request(app).post("/api/inventory").set("Cookie", firstCookie).type("json").send("{").expect(400);
    expect(await inventory.list(1)).toEqual([]);
  });

  it("returns a useful error without exposing database details", async () => {
    vi.spyOn(inventory, "list").mockRejectedValue(new Error("Private database details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await request(app).get("/api/inventory").set("Cookie", firstCookie);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Something went wrong. Please try again." });
    } finally {
      log.mockRestore();
    }
  });
});
