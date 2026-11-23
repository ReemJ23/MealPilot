# MealPilot

A meal planning and kitchen organization project for CIS 553 Software Engineering.

**Group 3**

**Student** Reem Jarrar

## Current stage

Users can create an account, log in, view their account, and log out. Accounts and login sessions are saved in MySQL. Recipes, the meal calendar, inventory, and shopping lists will be added in later branches.

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

The setup command creates `mealpilot` and the tables from `database/schema.sql`. Running it again preserves existing data. No seed data is required for the account feature. Create your own demo account using the registration form.

Open [MealPilot](http://127.0.0.1:5173). Use this exact address to match `APP_ORIGIN` in the configuration. Choose **Create an account**, enter your details, and submit. Keep the terminal and MySQL running while using the app. Press `Ctrl+C` in the terminal to stop the application.

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
| `npm.cmd run test:database` | Test actual database persistence and sessions |
| `npm.cmd run lint` | Run static analysis |
| `npm.cmd run typecheck` | Check TypeScript |
| `npm.cmd run build` | Build the applications |

The tests cover account validation, duplicate emails, password verification, protected access, session expiration, logout, and frontend error handling. Database tests also verify that login survives a new application instance and that rerunning setup preserves accounts.

GitHub Actions runs both check commands on pushes and Pull Requests, using a MySQL 8.4 service for database tests. Check the Actions result after pushing. Local verification for this branch also used MariaDB 11.8.6.

## Quick manual check

Register an account and confirm that your name and email appear. Refresh the page and confirm that you remain signed in. Log out, try an incorrect password, then log in with the correct password. Creating another account with the same email should show an error.

## Project structure

| Location | Purpose |
| --- | --- |
| `frontend/src` | Account interface, styles, and frontend tests |
| `backend/src` | Express application, account logic, and database access |
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
