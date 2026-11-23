import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Version the format so future password-hashing changes can be recognized. */
export class PasswordHasher {
  private readonly options = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const key = await this.derive(password, salt);
    return `scrypt-v1$${salt}$${key.toString("hex")}`;
  }

  async verify(password: string, storedHash?: string): Promise<boolean> {
    // Unknown accounts still perform the same expensive password calculation.
    const fallback = `scrypt-v1$${"0".repeat(32)}$${"0".repeat(128)}`;
    const parts = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(storedHash ?? fallback);
    if (!parts) return false;

    const actual = await this.derive(password, parts[1]);
    const expected = Buffer.from(parts[2], "hex");
    return timingSafeEqual(actual, expected) && storedHash !== undefined;
  }

  private derive(password: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, Buffer.from(salt, "hex"), 64, this.options, (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
  }
}
