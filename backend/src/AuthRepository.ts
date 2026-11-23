import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface StoredUser extends User {
  passwordHash: string;
}

/** This small interface lets API tests run without changing a real database. */
export interface AccountStore {
  createUser(name: string, email: string, passwordHash: string): Promise<User>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  createSession(userId: number, tokenHash: string, expiresAt: Date): Promise<void>;
  findUserBySession(tokenHash: string): Promise<User | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class AuthRepository implements AccountStore {
  constructor(private readonly pool: Pool) {}

  async createUser(name: string, email: string, passwordHash: string): Promise<User> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, passwordHash],
    );
    return { id: result.insertId, name, email };
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const [rows] = await this.pool.execute<(StoredUser & RowDataPacket)[]>(
      "SELECT id, name, email, password_hash AS passwordHash FROM users WHERE email = ?",
      [email],
    );
    return rows[0] ?? null;
  }

  async createSession(userId: number, tokenHash: string, expiresAt: Date): Promise<void> {
    // Remove expired sessions whenever a new session is created.
    await this.pool.execute("DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()");
    await this.pool.execute(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
      [tokenHash, userId, expiresAt],
    );
  }

  async findUserBySession(tokenHash: string): Promise<User | null> {
    const [rows] = await this.pool.execute<(User & RowDataPacket)[]>(
      `SELECT users.id, users.name, users.email
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > UTC_TIMESTAMP()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]);
  }
}
