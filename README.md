# MealPilot

A meal planning and kitchen organization project for CIS 553 Software Engineering.

**Group 3**

**Student** Reem Jarrar

## Current stage

Users can create an account and manage their own recipe collection. Recipes include a name, category, preparation time, servings, instructions, and an ordered list of ingredients with quantities and optional units. Users can view, edit, and delete their recipes.

The meal calendar uses [FullCalendar](https://fullcalendar.io/docs/react) to show weekly and monthly plans. Users can assign a saved recipe to a date, change the recipe or date, drag a meal to another day, and remove a planned meal.

Kitchen inventory lets users keep a personal ingredient list with optional quantities and units. They can add, view, edit, and remove items. Accounts and all personal data are saved in MySQL and belong to the signed-in user.

The shopping list supports manual items and purchased checkboxes. Users can also compare planned meals with their inventory, review missing ingredients, and add selected suggestions to their list.

Use **Discover recipes** in **My recipes** to search TheMealDB by name, read recipe details, and open an editable copy before saving. Check preparation time, servings and ingredient quantities because TheMealDB provides some measurements as free text and does not reliably supply time or serving counts. A quantity that cannot be parsed starts at 1 and is explicitly flagged for review. Saving creates an ordinary personal recipe in MySQL. The original external recipe is not changed.

TheMealDB's free development key is used for this educational project. Production use may require a supporter key under TheMealDB's terms.

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

## Use the shopping list

Open **Shopping list** to add or edit items. Quantity and unit are optional. A recorded shopping quantity must be positive and may have up to three decimal places. Use the purchased checkbox to track progress, or remove an item after confirming the action.

Choose **Generate from meals**, select the full period you intend to shop for, and choose **Find missing ingredients**. Both dates are included. Review the suggested amounts, deselect any ingredients you do not want, and choose **Add selected ingredients**.

The comparison follows these rules.

- Each planned occurrence contributes the recipe's recorded ingredient amounts. The same ingredient used in several meals is combined.
- Names and units match after ignoring capitalization and extra spaces. Use consistent names and units. For example, `g` and `kg` remain separate because the application does not convert units or recognize synonyms.
- Recorded inventory amounts and unpurchased shopping quantities reduce the amount still needed. A selected shortage increases an existing matching unpurchased item with a recorded quantity, or creates a new item. Repeating generation for an unchanged period adds nothing further.
- An unrecorded amount supplies no numeric credit. The preview flags matching inventory or shopping entries with unknown quantities so the user can check them before adding anything. Zero inventory means none remains.
- Purchased items are excluded from the comparison. Marking an item purchased does not update inventory. Update **Kitchen inventory** after shopping before generating again. Planning a meal does not consume inventory automatically.

Each account has one current shopping list. Generating suggestions preserves manual entries and purchased items. Saved shopping items remain independent of later recipe or calendar changes.

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

The tests cover authentication, input validation, CRUD operations, and frontend error handling. Ownership tests verify that one user cannot read or change another user's personal data. Database tests check persistence, session behavior, date storage, deletion rules, and transaction rollback when saving a recipe fails. Inventory tests distinguish an unrecorded quantity from zero and check decimal quantities.

Shopping tests cover partial stock, combined meal requirements, selected suggestions, purchase status, and repeated generation. The calculation uses integer thousandths to avoid decimal subtraction errors. Backend API test files run sequentially to use the setting that passed on Windows.

GitHub Actions runs both check commands on pushes and Pull Requests, using a MySQL 8.4 service for database tests. Check the Actions result after pushing. Local verification for this branch also used MariaDB 11.8.6.

## Quick manual check

Register an account and confirm that your name and email appear. Refresh the page and confirm that you remain signed in. Log out, try an incorrect password, then log in with the correct password. Creating another account with the same email should show an error.

Create a recipe with more than one ingredient, open its details, and refresh the page to check persistence. Edit an ingredient quantity and save. Cancel a deletion once, then confirm deletion. A second account should have its own separate collection.

In **Meal calendar**, add a saved recipe to a date. Refresh the page and reopen **Meal calendar** to check persistence. Switch between week and month views. Change a meal's date using its form, then try dragging it to another day. Remove the planned meal and confirm that the recipe remains in **My recipes**. A second account should have its own calendar.

In **Kitchen inventory**, add **Pasta** with quantity `500` and unit **g**. Add another ingredient with its quantity blank. Refresh the page and reopen the inventory to check persistence. Edit the pasta quantity to `0`, then change it to `250.5`. Cancel a removal once, then confirm removal. Check that the existing recipes and calendar entries remain. A second account should have its own inventory.

For reproducible demo data, create **Tomato pasta**, category **Dinner**, preparation time **20** minutes, and **2** servings. Add **200 g pasta** and **300 g tomatoes**. Use **Cook the pasta. Simmer the chopped tomatoes and combine with the pasta.** as the instructions. No external service or seed account is required.

For a repeatable shopping check, use a fresh account with empty inventory and no planned meals or shopping items. Create the demo recipe, plan it once for today, and record **50 g pasta** in inventory. Generate suggestions for today only. The result should be **150 g pasta** and **300 g tomatoes**. Add only pasta, then preview again. Only tomatoes should remain missing. Add tomatoes and confirm that repeating generation creates no additional amount. Mark an item purchased, refresh, and reopen **Shopping list** to check persistence. Also add a manual item with a blank quantity, edit it, and test cancelling and confirming removal. Another account should have its own list.

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
