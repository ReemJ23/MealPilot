import { createHash, randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Application } from "../src/Application.js";
import { AuthRepository } from "../src/AuthRepository.js";
import { createDatabasePool, initializeDatabase } from "../src/database.js";

// These tests use a separate database and remove only the accounts they create.
const databaseName = "mealpilot_test";
const pool = createDatabasePool(databaseName);
const emails: string[] = [];
const password = "MealPilot test password";

function newAccount() {
  const email = `${randomUUID()}@example.com`;
  emails.push(email);
  return { name: "Reem O'Brien", email, password };
}

function application() {
  return new Application(new AuthRepository(pool)).app;
}

function sessionCookie(response: request.Response): string {
  const headers = response.headers["set-cookie"] as unknown as string[];
  return headers[0].split(";")[0];
}

beforeAll(async () => {
  await initializeDatabase(databaseName);
});

afterAll(async () => {
  try {
    for (const email of emails) {
      // The foreign key removes the matching sessions too.
      await pool.execute("DELETE FROM users WHERE email = ?", [email]);
    }
  } finally {
    await pool.end();
  }
});

describe("Accounts with a real database", () => {
  it("persists the account and session across application instances without storing raw secrets", async () => {
    const account = newAccount();
    const registered = await request(application()).post("/api/auth/register").send(account);
    expect(registered.status).toBe(201);
    expect(registered.body.user).toMatchObject({ name: account.name, email: account.email });

    const cookie = sessionCookie(registered);
    const token = cookie.split("=")[1];
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT users.password_hash, sessions.token_hash
       FROM users JOIN sessions ON users.id = sessions.user_id WHERE users.email = ?`,
      [account.email],
    );
    expect(rows[0].password_hash).toMatch(/^scrypt-v1\$/);
    expect(rows[0].password_hash).not.toBe(account.password);
    expect(rows[0].token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(rows[0].token_hash).not.toBe(token);

    // A fresh pool and Application cannot rely on in-memory login state.
    const otherPool = createDatabasePool(databaseName);
    try {
      const restarted = new Application(new AuthRepository(otherPool));
      const me = await request(restarted.app).get("/api/auth/me").set("Cookie", cookie);
      expect(me.status).toBe(200);
      expect(me.body).toEqual(registered.body);
    } finally {
      await otherPool.end();
    }
  });

  it("enforces unique emails and preserves accounts when database setup is repeated", async () => {
    const account = newAccount();
    const app = application();
    await request(app).post("/api/auth/register").send(account).expect(201);
    await initializeDatabase(databaseName);

    const duplicate = await request(app).post("/api/auth/register")
      .send({ ...account, email: ` ${account.email.toUpperCase()} ` });
    expect(duplicate.status).toBe(409);

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM users WHERE email = ?", [account.email],
    );
    expect(rows[0].total).toBe(1);
  });

  it("checks the stored password, rotates a session and revokes it on logout", async () => {
    const account = newAccount();
    const app = application();
    const registered = await request(app).post("/api/auth/register").send(account).expect(201);
    const originalCookie = sessionCookie(registered);

    const wrong = await request(app).post("/api/auth/login")
      .send({ email: account.email, password: "An incorrect password" });
    expect(wrong.status).toBe(401);

    const login = await request(app).post("/api/auth/login").set("Cookie", originalCookie)
      .send({ email: account.email, password }).expect(200);
    const currentCookie = sessionCookie(login);
    expect(currentCookie).not.toBe(originalCookie);
    await request(app).get("/api/auth/me").set("Cookie", originalCookie).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", currentCookie).expect(200);

    await request(app).post("/api/auth/logout").set("Cookie", currentCookie).send({}).expect(204);
    await request(application()).get("/api/auth/me").set("Cookie", currentCookie).expect(401);
  });

  it("rejects an expired database session", async () => {
    const account = newAccount();
    const app = application();
    const registered = await request(app).post("/api/auth/register").send(account).expect(201);
    await pool.execute(
      "UPDATE sessions SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE user_id = ?",
      [registered.body.user.id],
    );
    await request(app).get("/api/auth/me").set("Cookie", sessionCookie(registered)).expect(401);
  });
});
