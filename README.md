# MealPilot

A web application for organizing recipes, planning meals, tracking kitchen ingredients, and preparing shopping lists.

**CIS 553 Software Engineering | Fall 2026 | Group 3**  
**Student** Reem Jarrar

## Features

- **Accounts**. Register, sign in, and keep personal data separate with persistent sessions.
- **My recipes**. Create, view, edit, and delete recipes with ingredients, quantities, instructions, preparation time, servings, and category.
- **Discover recipes**. Search [TheMealDB](https://www.themealdb.com/), review external recipes, and edit their details before saving them to your collection.
- **Meal calendar**. Plan meals in weekly or monthly views using [FullCalendar](https://fullcalendar.io/). Change dates, drag meals, or remove planned entries.
- **Kitchen inventory**. Record ingredients with optional quantities and units, then edit or remove them.
- **Shopping list**. Add items manually or generate missing ingredients from planned meals, review suggestions, and mark purchases.

MealPilot uses React and TypeScript on the frontend, Node.js and Express for the API, and MySQL for persistent storage.

## Run locally

### Requirements

- Node.js **24.15 or newer in the Node.js 24 series**, with npm **11 or newer**
- MySQL or MariaDB running locally. On Windows, XAMPP's MySQL service works. Apache is not required.
- Git and a modern desktop browser

### Windows setup with PowerShell

From a terminal, clone the repository and install the locked dependencies.

```powershell
git clone https://github.com/ReemJ23/MealPilot.git
cd MealPilot
npm.cmd ci
Copy-Item backend\.env.example backend\.env
```

Edit `backend/.env` if your database host, port, username, or password differs from the example. The default local configuration uses `127.0.0.1`, port `3306`, user `root`, and no password. Keep this file private.

Start MySQL, then initialize the database and run the application.

```powershell
npm.cmd run db:init
npm.cmd run dev
```

Open **http://127.0.0.1:5173**, create an account, and sign in. Use this exact address because it matches the example `APP_ORIGIN`. Leave MySQL and the development terminal running. Stop the application with `Ctrl+C`.

The database setup creates missing tables without deleting existing user data. There is no preconfigured account or required external API key for local development.

On macOS or Linux, use `npm` instead of `npm.cmd` and `cp backend/.env.example backend/.env` instead of `Copy-Item`.

## Try the main workflow

1. In **My recipes**, create **Tomato pasta** with category **Dinner**, preparation time **20 minutes**, **2 servings**, and instructions such as *Cook the pasta, prepare the tomato sauce, and combine.* Add **200 g pasta** and **300 g tomatoes** as ingredients.
2. In **Meal calendar**, schedule this recipe for a selected date. The meal remains saved after refreshing the page.
3. In **Kitchen inventory**, record **50 g pasta**.
4. In **Shopping list**, choose **Generate from meals** and select the date of the planned meal for both the start and end dates. The suggestions should include **150 g pasta** and **300 g tomatoes**.
5. Select the suggested ingredients to add them to the shopping list. Mark an item purchased and refresh to verify persistence.
6. To try external recipes, open **My recipes**, choose **Discover recipes**, search for `chicken`, and inspect a result. Review its ingredient measurements, preparation time, and servings before saving.

### Shopping list calculation rules

- Ingredients from every planned meal in the chosen date range are combined. Both date endpoints are included.
- Ingredient names and units are matched without regard to capitalization or repeated spaces. Different units, such as `g` and `kg`, are **not** converted or combined.
- Recorded inventory and unpurchased shopping quantities reduce the amount still needed. Repeating generation for an unchanged plan does not add the same shortage again.
- Blank inventory quantities mean **unknown**, not zero. Unknown amounts are flagged for review and do not reduce the calculated shortage.
- Marking an item purchased does **not** automatically increase inventory. Inventory remains manually maintained.

## Tests and code quality

Run these commands from the repository root.

```powershell
npm.cmd run check
npm.cmd run test:database
```

`check` runs ESLint with zero allowed warnings, TypeScript checks, backend and frontend tests, and production builds. The database test command requires MySQL and uses a separate `mealpilot_test` database. The database user must be allowed to create it.

The verified implementation passed **257 automated tests**, comprising **139 backend**, **79 frontend**, and **39 database integration** tests. The tests cover authentication, validation, account isolation, CRUD operations, meal planning, shopping calculations, persistence, and transaction handling.

- [Successful CI workflow](https://github.com/ReemJ23/MealPilot/actions/runs/45315637186)
- [Successful release workflow](https://github.com/ReemJ23/MealPilot/actions/runs/45315637253)

## Build and deployment

To build both applications locally, run `npm.cmd run build`. To serve the compiled frontend through Express instead of Vite, keep MySQL running and use the following PowerShell commands.

```powershell
$env:SERVE_FRONTEND="true"
$env:APP_ORIGIN="http://127.0.0.1:3000"
npm.cmd run start --workspace backend
```

Open **http://127.0.0.1:3000**. Use `Ctrl+C` to stop the server. Clear those temporary environment variables before returning to normal development.

GitHub Actions runs CI on pushes and pull requests. On updates to `main`, a separate workflow builds a downloadable application archive and publishes a production Docker image to **GitHub Container Registry**. Version tags beginning with `v` also trigger a GitHub Release.

The repository includes a multistage `Dockerfile` and an optional deployment stack with **Docker Compose, persistent MySQL storage, and Caddy HTTPS**. See **[Production deployment instructions](deploy/README.md)** for server setup, environment variables, updates, and backups.

**Automated release publishing has been verified. MealPilot is not currently hosted at a public URL.** A live deployment needs a server, domain, and private production credentials.

## Repository structure

| Path | Purpose |
| --- | --- |
| `frontend/src` | React interface and frontend tests |
| `backend/src` | Express controllers, business logic, and database repositories |
| `backend/tests` | API and MySQL integration tests |
| `database/schema.sql` | Database tables and relationships |
| `.github/workflows` | CI and automated release workflows |
| `Dockerfile` and `deploy/` | Production image and deployment configuration |

TheMealDB may return incomplete measurements or missing preparation times. Imported recipes can be corrected before saving. Passwords are stored using salted scrypt hashes, while session cookies are HttpOnly and personal records are restricted to the signed-in account.
