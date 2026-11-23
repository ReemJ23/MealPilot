import { Application } from "./Application.js";

const application = new Application();
const port = Number(process.env.PORT || 3000);

// Start the local development server separately from the testable application.
application.app.listen(port, "127.0.0.1", () => {
  console.log(`MealPilot API is running at http://127.0.0.1:${port}`);
});
