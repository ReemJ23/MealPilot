import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import type { AccountStore } from "../src/AuthRepository.js";
import { MAX_SHOPPING_QUANTITY, ShoppingListBuilder } from "../src/ShoppingListBuilder.js";
import type { ShoppingInput, ShoppingItem, ShoppingListStore, ShoppingPeriod } from "../src/ShoppingListRepository.js";

/** Route tests use memory storage. The separate database tests exercise SQL and transactions. */
class MemoryShoppingStore implements ShoppingListStore {
  private readonly records = new Map<number, { ownerId: number; item: ShoppingItem }>();
  private nextId = 1;
  preview = vi.fn<ShoppingListStore["preview"]>().mockResolvedValue({ mealCount: 0, suggestions: [] });
  generate = vi.fn<ShoppingListStore["generate"]>().mockResolvedValue({ items: [], addedCount: 0 });

  async list(userId: number): Promise<ShoppingItem[]> {
    return [...this.records.values()].filter((record) => record.ownerId === userId)
      .map(({ item }) => ({ ...item })).sort((first, second) => Number(first.purchased) - Number(second.purchased)
        || first.name.localeCompare(second.name) || first.id - second.id);
  }

  async create(userId: number, input: ShoppingInput): Promise<ShoppingItem> {
    const item = { ...input, id: this.nextId++, purchased: false };
    this.records.set(item.id, { ownerId: userId, item });
    return { ...item };
  }

  async update(userId: number, id: number, input: ShoppingInput): Promise<ShoppingItem | null> {
    const record = this.records.get(id);
    if (record?.ownerId !== userId) return null;
    record.item = { ...input, id, purchased: record.item.purchased };
    return { ...record.item };
  }

  async setPurchased(userId: number, id: number, purchased: boolean): Promise<ShoppingItem | null> {
    const record = this.records.get(id);
    if (record?.ownerId !== userId) return null;
    record.item.purchased = purchased;
    return { ...record.item };
  }

  async delete(userId: number, id: number): Promise<boolean> {
    if (this.records.get(id)?.ownerId !== userId) return false;
    return this.records.delete(id);
  }
}

const firstCookie = `mealpilot_session=${"a".repeat(64)}`;
const secondCookie = `mealpilot_session=${"b".repeat(64)}`;
const sessions = new Map([
  [createHash("sha256").update("a".repeat(64)).digest("hex"), { id: 1, name: "Reem", email: "reem@example.com" }],
  [createHash("sha256").update("b".repeat(64)).digest("hex"), { id: 2, name: "Second user", email: "second@example.com" }],
]);
const input: ShoppingInput = { name: "Rice", quantity: 1.5, unit: "kg" };
const period: ShoppingPeriod = { startDate: "2026-11-24", endDate: "2026-11-30" };
const key = ShoppingListBuilder.key("Rice", "kg");
let shopping: MemoryShoppingStore;
let app: Application["app"];

beforeEach(() => {
  shopping = new MemoryShoppingStore();
  const accounts: AccountStore = {
    createUser: vi.fn(), findUserByEmail: vi.fn(), createSession: vi.fn(), deleteSession: vi.fn(),
    findUserBySession: async (hash) => sessions.get(hash) ?? null,
  };
  app = new Application(accounts, { shopping }).app;
});

describe("Shopping list API", () => {
  it("creates a trimmed pending item and ignores submitted ownership and purchase state", async () => {
    const response = await request(app).post("/api/shopping-list").set("Cookie", firstCookie)
      .send({ ...input, name: " Rice ", unit: " kg ", userId: 2, id: 99, purchased: true });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item: { ...input, id: 1, purchased: false } });
    expect(await shopping.list(1)).toEqual([response.body.item]);
    expect(await shopping.list(2)).toEqual([]);
  });

  it("accepts an omitted quantity and unit or an explicit unknown amount", async () => {
    await request(app).post("/api/shopping-list").set("Cookie", firstCookie).send({ name: "Salt" })
      .expect(201, { item: { id: 1, name: "Salt", quantity: null, unit: "", purchased: false } });
    await request(app).post("/api/shopping-list").set("Cookie", firstCookie).send({ name: "Flour", quantity: null, unit: "g" })
      .expect(201, { item: { id: 2, name: "Flour", quantity: null, unit: "g", purchased: false } });
  });

  it("accepts the smallest, ordinary fractional and largest supported quantities", async () => {
    for (const quantity of [0.001, 0.125, MAX_SHOPPING_QUANTITY]) {
      const response = await request(app).post("/api/shopping-list").set("Cookie", firstCookie).send({ ...input, quantity });
      expect(response.status).toBe(201);
      expect(response.body.item.quantity).toBe(quantity);
    }
  });

  it("lists only the signed-in user's items without allowing cached personal data", async () => {
    const item = await shopping.create(1, input);
    await shopping.create(2, { ...input, name: "Private item" });
    const response = await request(app).get("/api/shopping-list").set("Cookie", firstCookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [item] });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("preserves purchase state during edits and lets a recorded amount be cleared", async () => {
    const item = await shopping.create(1, input);
    await shopping.setPurchased(1, item.id, true);
    const changed = { name: "Brown rice", quantity: null, unit: "" };
    await request(app).put(`/api/shopping-list/${item.id}`).set("Cookie", firstCookie)
      .send({ ...changed, purchased: false, userId: 2 })
      .expect(200, { item: { ...changed, id: item.id, purchased: true } });
    expect(await shopping.list(2)).toEqual([]);
  });

  it("marks and unmarks an item without changing its other fields", async () => {
    const item = await shopping.create(1, input);
    for (const purchased of [true, false]) {
      await request(app).patch(`/api/shopping-list/${item.id}`).set("Cookie", firstCookie)
        .send({ purchased, name: "Ignored", quantity: 999, userId: 2 })
        .expect(200, { item: { ...item, purchased } });
    }
  });

  it("removes an owned item with an empty successful response", async () => {
    const item = await shopping.create(1, input);
    const response = await request(app).delete(`/api/shopping-list/${item.id}`).set("Cookie", firstCookie).send({});
    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(await shopping.list(1)).toEqual([]);
  });

  it("requires a session for every shopping operation", async () => {
    await request(app).get("/api/shopping-list").expect(401);
    await request(app).post("/api/shopping-list").send(input).expect(401);
    await request(app).put("/api/shopping-list/1").send(input).expect(401);
    await request(app).patch("/api/shopping-list/1").send({ purchased: true }).expect(401);
    await request(app).delete("/api/shopping-list/1").send({}).expect(401);
    await request(app).post("/api/shopping-list/preview").send(period).expect(401);
    await request(app).post("/api/shopping-list/generate").send({ ...period, selectedKeys: [key] }).expect(401);
    expect(shopping.preview).not.toHaveBeenCalled();
    expect(shopping.generate).not.toHaveBeenCalled();
  });

  it("treats missing and another user's items alike without modifying them", async () => {
    const item = await shopping.create(1, input);
    for (const id of [item.id, 999]) {
      await request(app).put(`/api/shopping-list/${id}`).set("Cookie", secondCookie).send(input)
        .expect(404, { message: "Shopping item not found." });
      await request(app).patch(`/api/shopping-list/${id}`).set("Cookie", secondCookie).send({ purchased: true })
        .expect(404, { message: "Shopping item not found." });
      await request(app).delete(`/api/shopping-list/${id}`).set("Cookie", secondCookie).send({})
        .expect(404, { message: "Shopping item not found." });
    }
    expect(await shopping.list(1)).toEqual([item]);
  });

  it("rejects malformed IDs for edits, purchase changes and removal", async () => {
    for (const id of ["0", "01", "-1", "1.5", "abc", "1e2", "4294967296"]) {
      await request(app).put(`/api/shopping-list/${id}`).set("Cookie", firstCookie).send(input).expect(400);
      await request(app).patch(`/api/shopping-list/${id}`).set("Cookie", firstCookie).send({ purchased: true }).expect(400);
      await request(app).delete(`/api/shopping-list/${id}`).set("Cookie", firstCookie).send({}).expect(400);
    }
  });

  it.each([
    ["blank name", { name: " " }],
    ["long name", { name: "a".repeat(101) }],
    ["invalid name type", { name: 123 }],
    ["zero quantity", { quantity: 0 }],
    ["negative quantity", { quantity: -1 }],
    ["quantity above the limit", { quantity: 10_000_000_000 }],
    ["excess quantity precision", { quantity: 0.1234 }],
    ["numeric string quantity", { quantity: "2" }],
    ["empty string quantity", { quantity: "" }],
    ["boolean quantity", { quantity: false }],
    ["invalid unit type", { unit: null }],
    ["long unit", { unit: "a".repeat(31) }],
  ])("rejects %s without saving an item", async (_label, invalid) => {
    await request(app).post("/api/shopping-list").set("Cookie", firstCookie).send({ ...input, ...invalid }).expect(400);
    expect(await shopping.list(1)).toEqual([]);
  });

  it("rejects incomplete bodies and non-finite quantities", async () => {
    for (const body of [{}, []]) {
      await request(app).post("/api/shopping-list").set("Cookie", firstCookie).send(body).expect(400);
    }
    await request(app).post("/api/shopping-list").set("Cookie", firstCookie).type("json")
      .send('{"name":"Rice","quantity":1e309}').expect(400);
    expect(await shopping.list(1)).toEqual([]);
  });

  it("preserves a saved item after invalid edits and purchase values", async () => {
    const item = await shopping.create(1, input);
    await request(app).put(`/api/shopping-list/${item.id}`).set("Cookie", firstCookie).send({ ...input, quantity: 0 }).expect(400);
    for (const body of [{}, [], { purchased: "true" }, { purchased: 1 }, { purchased: null }]) {
      await request(app).patch(`/api/shopping-list/${item.id}`).set("Cookie", firstCookie).send(body).expect(400);
    }
    expect(await shopping.list(1)).toEqual([item]);
  });

  it("previews the selected dates using session ownership and the repository result", async () => {
    const preview = { mealCount: 2, suggestions: [{ key, ...input, quantity: 0.5, hasUnknownQuantity: true }] };
    shopping.preview.mockResolvedValue(preview);
    await request(app).post("/api/shopping-list/preview").set("Cookie", firstCookie).send({ ...period, userId: 2 })
      .expect(200, preview);
    expect(shopping.preview).toHaveBeenCalledWith(1, period);
    expect(shopping.generate).not.toHaveBeenCalled();
  });

  it("accepts a single leap day without converting the selected dates", async () => {
    const dates = { startDate: "2028-02-29", endDate: "2028-02-29" };
    await request(app).post("/api/shopping-list/preview").set("Cookie", firstCookie).send(dates).expect(200);
    expect(shopping.preview).toHaveBeenCalledWith(1, dates);
  });

  it("rejects impossible, malformed or reversed periods before preview or generation", async () => {
    for (const dates of [
      {}, [], { ...period, startDate: "2026-02-29" }, { ...period, endDate: "2026-11-31" },
      { ...period, startDate: "2026-1-01" }, { ...period, startDate: "0999-01-01" },
      { ...period, endDate: "10000-01-01" }, { ...period, endDate: "2026-11-23" },
      { ...period, startDate: 20261124 }, { ...period, startDate: "2026-11-24T00:00:00Z" },
    ]) {
      await request(app).post("/api/shopping-list/preview").set("Cookie", firstCookie).send(dates).expect(400);
      await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
        .send({ ...dates, selectedKeys: [key] }).expect(400);
    }
    expect(shopping.preview).not.toHaveBeenCalled();
    expect(shopping.generate).not.toHaveBeenCalled();
  });

  it("passes unique selected keys while ignoring client quantities and ownership", async () => {
    const result = { items: [{ ...input, id: 1, purchased: false }], addedCount: 1 };
    shopping.generate.mockResolvedValue(result);
    await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
      .send({ ...period, selectedKeys: [key, key], userId: 2, quantity: 999, items: [{ ...input, quantity: 999 }] })
      .expect(200, result);
    expect(shopping.generate).toHaveBeenCalledWith(1, period, [key]);
  });

  it("requires a nonempty array of string selection keys", async () => {
    for (const selectedKeys of [undefined, null, [], key, [key, 1], [null]]) {
      await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
        .send({ ...period, selectedKeys }).expect(400);
    }
    expect(shopping.generate).not.toHaveBeenCalled();
  });

  it("returns a successful unchanged result for stale or already covered selections", async () => {
    await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
      .send({ ...period, selectedKeys: [key] }).expect(200, { items: [], addedCount: 0 });
  });

  it("reports unsupported calculations as useful validation errors", async () => {
    const message = "The missing quantity is too large. Choose a shorter date range.";
    shopping.preview.mockRejectedValue(new RangeError(message));
    shopping.generate.mockRejectedValue(new RangeError(message));
    await request(app).post("/api/shopping-list/preview").set("Cookie", firstCookie).send(period).expect(400, { message });
    await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
      .send({ ...period, selectedKeys: [key] }).expect(400, { message });
  });

  it("applies the shared origin and JSON protections to shopping writes", async () => {
    await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
      .set("Origin", "https://another-site.example").send({ ...period, selectedKeys: [key] }).expect(403);
    await request(app).patch("/api/shopping-list/1").set("Cookie", firstCookie).type("form").send("purchased=true").expect(415);
    await request(app).post("/api/shopping-list/preview").set("Cookie", firstCookie).type("json").send("{").expect(400);
    expect(shopping.generate).not.toHaveBeenCalled();
    expect(shopping.preview).not.toHaveBeenCalled();
  });

  it("hides database failure details from list and generation responses", async () => {
    vi.spyOn(shopping, "list").mockRejectedValue(new Error("Private database details"));
    shopping.generate.mockRejectedValue(new Error("Private transaction details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const expected = { message: "Something went wrong. Please try again." };
      await request(app).get("/api/shopping-list").set("Cookie", firstCookie).expect(500, expected);
      await request(app).post("/api/shopping-list/generate").set("Cookie", firstCookie)
        .send({ ...period, selectedKeys: [key] }).expect(500, expected);
    } finally {
      log.mockRestore();
    }
  });
});

describe("Shopping shortage calculation", () => {
  const builder = new ShoppingListBuilder();

  it("combines repeated requirements and subtracts partial stock and pending amounts exactly", () => {
    const required = [{ name: "Rice", quantity: 0.1, unit: "kg" }, { name: "Rice", quantity: 0.2, unit: "kg" }];
    const inventory = [{ name: "Rice", quantity: 0.1, unit: "kg" }];
    const pending = [{ id: 1, name: "Rice", quantity: 0.1, unit: "kg", purchased: false }];
    const original = structuredClone({ required, inventory, pending });
    expect(builder.build(required, inventory, pending)).toEqual([
      { key, name: "Rice", quantity: 0.1, unit: "kg", hasUnknownQuantity: false },
    ]);
    expect({ required, inventory, pending }).toEqual(original);
  });

  it("matches case and repeated whitespace while preserving the first recipe's display spelling", () => {
    const required = [{ name: " Brown  Rice ", quantity: 3, unit: " Kg " }, { name: "brown rice", quantity: 2, unit: "kg" }];
    const inventory = [{ name: " BROWN\tRICE ", quantity: 1, unit: "KG" }];
    expect(builder.build(required, inventory, [])).toEqual([
      { key: '["brown rice","kg"]', name: "Brown  Rice", quantity: 4, unit: "Kg", hasUnknownQuantity: false },
    ]);
  });

  it("keeps incompatible units and different ingredient names separate and sorts suggestions", () => {
    const required = [
      { name: "Rice", quantity: 2, unit: "cup" }, { name: "Beans", quantity: 1, unit: "kg" },
      { name: "Rice", quantity: 1, unit: "kg" }, { name: "Bean", quantity: 1, unit: "kg" },
    ];
    const result = builder.build(required, [{ name: "Rice", quantity: 1, unit: "kg" }], []);
    expect(result.map(({ name, quantity, unit }) => ({ name, quantity, unit }))).toEqual([
      { name: "Bean", quantity: 1, unit: "kg" }, { name: "Beans", quantity: 1, unit: "kg" },
      { name: "Rice", quantity: 2, unit: "cup" },
    ]);
  });

  it("flags unknown matching amounts without treating them or zero stock as coverage", () => {
    const required = [{ name: "Rice", quantity: 2, unit: "kg" }, { name: "Salt", quantity: 1, unit: "tsp" }];
    const inventory = [{ name: "Rice", quantity: null, unit: "kg" }, { name: "Rice", quantity: 0, unit: "kg" }];
    const pending = [{ id: 1, name: "Salt", quantity: null, unit: "tsp", purchased: false }];
    expect(builder.build(required, inventory, pending)).toEqual([
      { key, name: "Rice", quantity: 2, unit: "kg", hasUnknownQuantity: true },
      { key: '["salt","tsp"]', name: "Salt", quantity: 1, unit: "tsp", hasUnknownQuantity: true },
    ]);
  });

  it("ignores purchased quantities and purchased unknown amounts", () => {
    const purchased = [
      { id: 1, name: "Rice", quantity: 10, unit: "kg", purchased: true },
      { id: 2, name: "Rice", quantity: null, unit: "kg", purchased: true },
    ];
    expect(builder.build([{ name: "Rice", quantity: 2, unit: "kg" }], [], purchased)).toEqual([
      { key, name: "Rice", quantity: 2, unit: "kg", hasUnknownQuantity: false },
    ]);
  });

  it("returns no suggestions when stock or pending items cover the requirements", () => {
    const required = [{ name: "Rice", quantity: 2, unit: "kg" }, { name: "Salt", quantity: 1, unit: "tsp" }];
    const inventory = [{ name: "Rice", quantity: 5, unit: "kg" }, { name: "Salt", quantity: null, unit: "tsp" }];
    const pending = [{ id: 1, name: "Salt", quantity: 1, unit: "tsp", purchased: false }];
    expect(builder.build(required, inventory, pending)).toEqual([]);
    expect(builder.build([], inventory, pending)).toEqual([]);
  });

  it("checks the final shortage limit after subtracting available stock", () => {
    const required = [{ name: "Rice", quantity: MAX_SHOPPING_QUANTITY, unit: "kg" }, { name: "Rice", quantity: 1, unit: "kg" }];
    expect(() => builder.build(required, [], [])).toThrow(RangeError);
    expect(builder.build(required, [{ name: "Rice", quantity: 1, unit: "kg" }], [])[0].quantity).toBe(MAX_SHOPPING_QUANTITY);
    expect(() => builder.build([{ name: "Rice", quantity: Number.MAX_SAFE_INTEGER, unit: "kg" }], [], [])).toThrow(RangeError);
  });
});
