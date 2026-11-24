import { Application } from "./Application.js";
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
});
const port = Number(process.env.PORT || 3000);

try {
  // Fail early with a useful message if the database has not been set up.
  await pool.query("SELECT id FROM users LIMIT 1");
  const server = application.app.listen(port, "127.0.0.1", () => {
    console.log(`MealPilot API is running at http://127.0.0.1:${port}`);
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
