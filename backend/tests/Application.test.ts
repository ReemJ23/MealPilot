import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../src/Application.js";
import type { AccountStore, StoredUser, User } from "../src/AuthRepository.js";
import { PasswordHasher } from "../src/PasswordHasher.js";

/** Use a fresh in-memory store for each API test. SQL has its own integration tests. */
class MemoryAccountStore implements AccountStore {
  readonly users: StoredUser[] = [];
  readonly sessions = new Map<string, { userId: number; expiresAt: Date }>();

  async createUser(name: string, email: string, passwordHash: string): Promise<User> {
    if (this.users.some((user) => user.email === email)) {
      throw Object.assign(new Error("Duplicate email"), { code: "ER_DUP_ENTRY" });
    }
    const user = { id: this.users.length + 1, name, email };
    this.users.push({ ...user, passwordHash });
    return user;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.users.find((user) => user.email === email) ?? null;
  }

  async createSession(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async findUserBySession(tokenHash: string): Promise<User | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt.getTime() <= Date.now()) return null;
    const user = this.users.find((entry) => entry.id === session.userId);
    return user ? { id: user.id, name: user.name, email: user.email } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

const account = { name: "Reem", email: "reem@example.com", password: "MyMealPlan2026" };
let store: MemoryAccountStore;
let application: Application;

beforeEach(() => {
  store = new MemoryAccountStore();
  application = new Application(store);
});

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

describe("User accounts", () => {
  it("registers, hashes the password, and restores the user from the session cookie", async () => {
    const client = request.agent(application.app);
    const response = await client.post("/api/auth/register").send({ ...account, name: " Reem ", email: " Reem@Example.com " });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ user: { id: 1, name: "Reem", email: account.email } });
    expect(store.users[0].passwordHash).not.toContain(account.password);
    expect(await new PasswordHasher().verify(account.password, store.users[0].passwordHash)).toBe(true);

    const cookie = response.headers["set-cookie"][0] as string;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).not.toContain("Secure");
    const token = cookie.split(";")[0].split("=")[1];
    const tokenHash = createHash("sha256").update(token).digest("hex");
    expect(store.sessions.has(tokenHash)).toBe(true);
    expect(store.sessions.has(token)).toBe(false);

    const restored = await client.get("/api/auth/me");
    expect(restored.status).toBe(200);
    expect(restored.body).toEqual(response.body);
    expect(restored.headers["cache-control"]).toBe("no-store");
  });

  it("rejects a duplicate email even when its capitalization changes", async () => {
    await request(application.app).post("/api/auth/register").send(account);
    const response = await request(application.app).post("/api/auth/register").send({ ...account, email: "REEM@example.com" });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/already exists/);
    expect(store.users).toHaveLength(1);
  });

  it.each([
    { name: " " },
    { name: "a".repeat(81) },
    { email: "invalid-email" },
    { password: "short" },
    { password: "a".repeat(129) },
    { password: 12345678 },
  ])("rejects invalid registration fields %j", async (invalid) => {
    const response = await request(application.app).post("/api/auth/register").send({ ...account, ...invalid });
    expect(response.status).toBe(400);
    expect(store.users).toHaveLength(0);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("requires a valid session to read the account", async () => {
    const response = await request(application.app).get("/api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Please sign in to continue." });
  });

  it("uses the same error for an incorrect password and an unknown email", async () => {
    await request(application.app).post("/api/auth/register").send(account);
    const incorrect = await request(application.app).post("/api/auth/login").send({ email: account.email, password: "incorrect-password" });
    const unknown = await request(application.app).post("/api/auth/login").send({ email: "unknown@example.com", password: account.password });
    expect(incorrect.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(incorrect.body).toEqual(unknown.body);
    expect(incorrect.headers["set-cookie"]).toBeUndefined();
  });

  it("signs in with normalized email and replaces an existing session", async () => {
    const client = request.agent(application.app);
    const registration = await client.post("/api/auth/register").send(account);
    const oldCookie = registration.headers["set-cookie"][0].split(";")[0] as string;
    const login = await client.post("/api/auth/login").send({ email: " REEM@EXAMPLE.COM ", password: account.password });
    expect(login.status).toBe(200);
    expect(login.body).toEqual(registration.body);
    expect(store.sessions.size).toBe(1);
    expect((await client.get("/api/auth/me")).status).toBe(200);
    expect((await request(application.app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(401);
  });

  it("revokes the session on logout so the old cookie cannot be reused", async () => {
    const client = request.agent(application.app);
    const registration = await client.post("/api/auth/register").send(account);
    const oldCookie = registration.headers["set-cookie"][0].split(";")[0] as string;
    const logout = await client.post("/api/auth/logout").send({});
    expect(logout.status).toBe(204);
    expect(logout.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970");
    expect(store.sessions.size).toBe(0);
    expect((await request(application.app).get("/api/auth/me").set("Cookie", oldCookie)).status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const client = request.agent(application.app);
    await client.post("/api/auth/register").send(account);
    for (const session of store.sessions.values()) session.expiresAt = new Date(0);
    expect((await client.get("/api/auth/me")).status).toBe(401);
  });

  it("handles malformed cookies without a server error", async () => {
    const response = await request(application.app).get("/api/auth/me").set("Cookie", "mealpilot_session=%invalid");
    expect(response.status).toBe(401);
  });

  it("rejects cross-origin writes before creating a user", async () => {
    const response = await request(application.app).post("/api/auth/register").set("Origin", "https://another-site.example").send(account);
    expect(response.status).toBe(403);
    expect(store.users).toHaveLength(0);
  });

  it("rejects non-JSON writes and malformed JSON", async () => {
    const nonJson = await request(application.app).post("/api/auth/logout").type("form").send("ignored=value");
    const malformed = await request(application.app).post("/api/auth/register").type("json").send("{");
    expect(nonJson.status).toBe(415);
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ message: "Send valid JSON." });
  });

  it("sets Secure on cookies when the application uses HTTPS", async () => {
    const secureApplication = new Application(store, { secureCookies: true });
    const response = await request(secureApplication.app).post("/api/auth/register").send(account);
    expect(response.status).toBe(201);
    expect(response.headers["set-cookie"][0]).toContain("Secure");
  });

  it("limits repeated failed authentication attempts", async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await request(application.app).post("/api/auth/login").send({})).status).toBe(400);
    }
    const response = await request(application.app).post("/api/auth/login").send({});
    expect(response.status).toBe(429);
    expect(response.body.message).toMatch(/Too many attempts/);
  });

  it("also counts successful registrations toward the request limit", async () => {
    for (let attempt = 0; attempt < 19; attempt++) {
      await request(application.app).post("/api/auth/login").send({}).expect(400);
    }
    await request(application.app).post("/api/auth/register").send(account).expect(201);
    await request(application.app).post("/api/auth/register")
      .send({ ...account, email: "another@example.com" }).expect(429);
    expect(store.users).toHaveLength(1);
  });

  it("returns a useful error without exposing a database failure", async () => {
    vi.spyOn(store, "findUserByEmail").mockRejectedValue(new Error("Private database details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await request(application.app).post("/api/auth/login").send(account);
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Something went wrong. Please try again." });
    } finally {
      log.mockRestore();
    }
  });
});
