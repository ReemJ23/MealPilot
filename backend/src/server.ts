import { Application } from "./Application.js";
import { fileURLToPath } from "node:url";
import { AuthRepository } from "./AuthRepository.js";
import { RecipeRepository } from "./RecipeRepository.js";
import { MealPlanRepository } from "./MealPlanRepository.js";
import { InventoryRepository } from "./InventoryRepository.js";
import { ShoppingListRepository } from "./ShoppingListRepository.js";
import { createDatabasePool } from "./database.js";

const pool = createDatabasePool();
const application = new Application(new AuthRepository(pool), {
  origin: process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  secureCookies: process.env.NODE_ENV === "production",
  recipes: new RecipeRepository(pool),
  meals: new MealPlanRepository(pool),
  inventory: new InventoryRepository(pool),
  shopping: new ShoppingListRepository(pool),
  // Docker and release builds include the Vite output alongside the API.
  staticDirectory: process.env.SERVE_FRONTEND === "true"
    ? fileURLToPath(new URL("../../frontend/dist/", import.meta.url)) : undefined,
});
const port = Number(process.env.PORT || 3000);

try {
  // Fail early with a useful message if the database has not been set up.
  await pool.query("SELECT id FROM users LIMIT 1");
  // A container listens on all interfaces; local development stays on loopback.
  const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  const server = application.app.listen(port, host, () => {
    console.log(`MealPilot is running on ${host}:${port}`);
  });

  const shutdown = (): void => {
    server.close(() => { void pool.end(); });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error("Cannot start MealPilot. Start MySQL, check backend/.env and run npm run db:init.");
  console.error(error instanceof Error ? error.message : "Unable to connect to the database.");
  await pool.end();
  process.exitCode = 1;
}
