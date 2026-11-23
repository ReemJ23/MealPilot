import { createHash, randomBytes } from "node:crypto";
import { parseCookie } from "cookie";
import { json, Router } from "express";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { AccountStore, User } from "./AuthRepository.js";
import { PasswordHasher } from "./PasswordHasher.js";

const cookieName = "mealpilot_session";
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

export class AuthController {
  readonly router = Router();
  private readonly hasher = new PasswordHasher();
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly repository: AccountStore,
    origin: string,
    secureCookies: boolean,
  ) {
    this.cookieOptions = { httpOnly: true, sameSite: "lax", secure: secureCookies, path: "/api" };

    this.router.use((request, response, next) => {
      response.set("Cache-Control", "no-store");
      if (request.method !== "GET" && request.method !== "HEAD") {
        // Only our own frontend may submit browser requests that change an account.
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
    this.router.use(json({ limit: "16kb" }));

    const attemptLimit = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { message: "Too many attempts. Please try again in 15 minutes." },
    });
    this.router.post("/register", attemptLimit, this.register);
    this.router.post("/login", attemptLimit, this.login);
    this.router.post("/logout", this.logout);
    this.router.get("/me", this.requireUser, (_request, response) => {
      response.json({ user: response.locals.user });
    });
  }

  /** Later recipe and planning routes can use this middleware as well. */
  readonly requireUser = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const tokenHash = this.readTokenHash(request);
    const user = tokenHash ? await this.repository.findUserBySession(tokenHash) : null;
    if (!user) {
      response.status(401).json({ message: "Please sign in to continue." });
      return;
    }
    response.locals.user = user;
    next();
  };

  private register = async (request: Request, response: Response): Promise<void> => {
    const body = request.body as Record<string, unknown> | undefined;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = this.readEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";

    if (name.length < 2 || name.length > 80) {
      response.status(400).json({ message: "Enter a name between 2 and 80 characters." });
      return;
    }
    if (!email) {
      response.status(400).json({ message: "Enter a valid email address." });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      response.status(400).json({ message: "Use a password between 8 and 128 characters." });
      return;
    }

    const passwordHash = await this.hasher.hash(password);
    let user: User;
    try {
      user = await this.repository.createUser(name, email, passwordHash);
    } catch (error) {
      // The unique database constraint also handles two simultaneous registrations.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") {
        response.status(409).json({ message: "An account with that email already exists." });
        return;
      }
      throw error;
    }
    await this.startSession(request, response, user.id);
    response.status(201).json({ user });
  };

  private login = async (request: Request, response: Response): Promise<void> => {
    const body = request.body as Record<string, unknown> | undefined;
    const email = this.readEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || password.length < 8 || password.length > 128) {
      response.status(400).json({ message: "Enter a valid email and a password between 8 and 128 characters." });
      return;
    }

    const user = await this.repository.findUserByEmail(email);
    const matches = await this.hasher.verify(password, user?.passwordHash);
    if (!user || !matches) {
      response.status(401).json({ message: "The email or password is incorrect." });
      return;
    }
    await this.startSession(request, response, user.id);
    response.json({ user: { id: user.id, name: user.name, email: user.email } });
  };

  private logout = async (request: Request, response: Response): Promise<void> => {
    const tokenHash = this.readTokenHash(request);
    if (tokenHash) await this.repository.deleteSession(tokenHash);
    response.clearCookie(cookieName, this.cookieOptions);
    response.status(204).end();
  };

  private async startSession(request: Request, response: Response, userId: number): Promise<void> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await this.repository.createSession(userId, tokenHash, new Date(Date.now() + sessionLifetime));

    // Replacing a session also invalidates the old cookie on the server.
    const previousHash = this.readTokenHash(request);
    if (previousHash) await this.repository.deleteSession(previousHash);
    response.cookie(cookieName, token, { ...this.cookieOptions, maxAge: sessionLifetime });
  }

  private readTokenHash(request: Request): string | null {
    const token = parseCookie(request.headers.cookie ?? "")[cookieName];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return createHash("sha256").update(token).digest("hex");
  }

  private readEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }
}
