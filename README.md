# MealPilot

A meal planning and kitchen organization project for CIS 553 Software Engineering.

**Group 3**

**Student** Reem Jarrar

## Current stage

Users can create an account and manage their own recipe collection. Recipes include a name, category, preparation time, servings, instructions, and an ordered list of ingredients with quantities and optional units. Users can view, edit, and delete their recipes.

The meal calendar uses [FullCalendar](https://fullcalendar.io/docs/react) to show weekly and monthly plans. Users can assign a saved recipe to a date, change the recipe or date, drag a meal to another day, and remove a planned meal.

Kitchen inventory lets users keep a personal ingredient list with optional quantities and units. They can add, view, edit, and remove items. Accounts and all personal data are saved in MySQL and belong to the signed-in user.

Shopping lists and external recipe browsing will be added in later branches.

Passwords are stored as salted scrypt hashes. Login uses an HttpOnly cookie and a database session that expires after seven days. Logout invalidates that session on the server. The hashing settings follow the [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt).

## Requirements

Use Node.js 24.15 or newer within the Node.js 24 release line, with npm 11 or newer. This package was prepared using Node.js 24.22.3.

Start a MySQL or MariaDB server. On Windows, the MySQL service in XAMPP is suitable. Apache is not needed for this application.

## Run locally

Run all commands from the MealPilot repository folder in the VS Code terminal.

Install dependencies and create your local configuration on the first setup. Keep an existing `backend/.env` when updating the project.

```powershell
npm.cmd ci
Copy-Item backend\.env.example backend\.env
```

Open `backend/.env` and match the database settings to your installation. The example uses port `3306`, user `root`, and an empty password for a local XAMPP setup. If you configured a database password, enter it in `DB_PASSWORD`. This file is ignored by Git. Use a separate database user and private credentials when deploying.

Create the database and start the application.

```powershell
npm.cmd run db:init
npm.cmd run dev
```

The setup command creates `mealpilot` and any missing tables from `database/schema.sql`. Run it again when updating from an earlier branch to add the new tables. Existing accounts and data are preserved.

Open [MealPilot](http://127.0.0.1:5173). Use this exact address to match `APP_ORIGIN` in the configuration. Choose **Create an account**, enter your details, and submit. Keep the terminal and MySQL running while using the app. Press `Ctrl+C` in the terminal to stop the application.

After signing in, choose **New recipe** to build your collection. Ingredient quantities support up to three decimal places. Units may be left blank for whole items. Category is a free text field, such as Dinner or Breakfast.

Open **Meal calendar** to plan your saved recipes. Select a date or use **Add meal**, choose a recipe, and save. Select an existing meal to change its recipe or date, or drag it to another day. Use the calendar controls to switch between week and month views. More than one meal can be planned on the same date.

Removing a calendar entry keeps the original recipe. Deleting a recipe also removes its planned meals, as stated in the deletion confirmation. Calendar dates are stored as dates without time zones or meal times.

Open **Kitchen inventory** to record ingredients you have at home. Ingredient names are required. Quantity and unit are optional, and quantities support up to three decimal places. Leaving quantity blank means the amount has not been recorded. Entering `0` records that none remains. Editing or removing inventory items does not change saved recipes or calendar entries. Inventory amounts are entered manually and are not reduced when a meal is planned.

On macOS or Linux, use `npm` instead of `npm.cmd` and `cp backend/.env.example backend/.env` to create the configuration.

## Check the project

```powershell
npm.cmd run check
```

This runs ESLint, TypeScript checks, API tests, frontend tests, and builds. These API tests use an in-memory repository so they do not require a running database.

With MySQL running, also run the database integration tests.

```powershell
npm.cmd run test:database
```

These tests create the separate `mealpilot_test` database using the connection settings in `backend/.env`. They remove only their own test accounts. The configured database user needs permission to create this test database.

| Command | Purpose |
| --- | --- |
| `npm.cmd test` | Run frontend and backend tests |
| `npm.cmd run test:database` | Test personal data and login sessions against the database |
| `npm.cmd run lint` | Run static analysis |
| `npm.cmd run typecheck` | Check TypeScript |
| `npm.cmd run build` | Build the applications |

The tests cover authentication, input validation, CRUD operations, and frontend error handling. Ownership tests verify that one user cannot read or change another user's personal data. Database tests check persistence, session behavior, date storage, deletion rules, and transaction rollback when saving a recipe fails. Inventory tests distinguish an unrecorded quantity from zero and check decimal quantities. Backend API test files run sequentially to use the setting that passed on Windows.

GitHub Actions runs both check commands on pushes and Pull Requests, using a MySQL 8.4 service for database tests. Check the Actions result after pushing. Local verification for this branch also used MariaDB 11.8.6.

## Quick manual check

Register an account and confirm that your name and email appear. Refresh the page and confirm that you remain signed in. Log out, try an incorrect password, then log in with the correct password. Creating another account with the same email should show an error.

Create a recipe with more than one ingredient, open its details, and refresh the page to check persistence. Edit an ingredient quantity and save. Cancel a deletion once, then confirm deletion. A second account should have its own separate collection.

In **Meal calendar**, add a saved recipe to a date. Refresh the page and reopen **Meal calendar** to check persistence. Switch between week and month views. Change a meal's date using its form, then try dragging it to another day. Remove the planned meal and confirm that the recipe remains in **My recipes**. A second account should have its own calendar.

In **Kitchen inventory**, add **Pasta** with quantity `500` and unit **g**. Add another ingredient with its quantity blank. Refresh the page and reopen the inventory to check persistence. Edit the pasta quantity to `0`, then change it to `250.5`. Cancel a removal once, then confirm removal. Check that the existing recipes and calendar entries remain. A second account should have its own inventory.

For reproducible demo data, create **Tomato pasta**, category **Dinner**, preparation time **20** minutes, and **2** servings. Add **200 g pasta** and **300 g tomatoes**. Use **Cook the pasta. Simmer the chopped tomatoes and combine with the pasta.** as the instructions. No external service or seed account is required.

## Project structure

| Location | Purpose |
| --- | --- |
| `frontend/src` | User interfaces and their frontend tests |
| `backend/src` | Express application, feature logic, and database access |
| `backend/tests` | API and database integration tests |
| `backend/scripts/initDatabase.ts` | Database setup command |
| `backend/.env.example` | Example local configuration |
| `database/schema.sql` | Reproducible database tables |
| `.github/workflows/ci.yml` | Automated CI checks |
| `eslint.config.mjs` | Static analysis configuration |
| `package-lock.json` | Exact dependency versions |

The root npm workspace configuration lets both applications share one installation command. Each application has its own package and TypeScript configuration.

## Build and deployment status

The build command writes files to `frontend/dist` and `backend/dist`. The compiled backend starts with `npm.cmd run start --workspace backend`. To check the built frontend locally, run `npm.cmd run preview --workspace frontend` in another terminal.

Production hosting and automated deployment will be added in the deployment branch. That configuration must provide a persistent database and HTTPS, set `APP_ORIGIN` to the deployed frontend address, and use `NODE_ENV=production` for Secure cookies. The local preview uses the development settings.
