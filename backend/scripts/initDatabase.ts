import { databaseOptions, initializeDatabase } from "../src/database.js";

try {
  await initializeDatabase();
  console.log(`Database ${databaseOptions.database} is ready.`);
} catch (error) {
  console.error("Database setup failed. Check that MySQL is running and backend/.env is correct.");
  console.error(error instanceof Error ? error.message : "Unable to connect to the database.");
  process.exitCode = 1;
}
