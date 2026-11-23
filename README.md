# MealPilot

A meal planning and kitchen organization project for CIS 553 Software Engineering.

**Group 3**

**Student** Reem Jarrar

## Current stage

The project foundation contains a React page connected to an Express backend. Accounts, recipes, the meal calendar, inventory, and shopping lists will be added in later branches.

## Requirements

Use Node.js 24.15 or newer within the Node.js 24 release line, with npm 11 or newer. This package was prepared using Node.js 24.22.3.

MySQL and local environment files are not needed for this branch.

## Run locally

Run these commands from the MealPilot repository folder.

```powershell
npm.cmd ci
npm.cmd run dev
```

Open [MealPilot](http://127.0.0.1:5173) and check for **MealPilot is connected**. Keep the terminal open while using the app. Press `Ctrl+C` to stop it.

On macOS or Linux, use `npm` instead of `npm.cmd`.

## Check the project

```powershell
npm.cmd run check
```

This runs ESLint, TypeScript checks, automated tests, and builds for both applications. The same command runs in GitHub Actions after a push or Pull Request.

| Command | Purpose |
| --- | --- |
| `npm.cmd test` | Run frontend and backend tests |
| `npm.cmd run lint` | Run static analysis |
| `npm.cmd run typecheck` | Check TypeScript |
| `npm.cmd run build` | Build the applications |

The API tests check the health endpoint and missing routes. The frontend tests check a successful connection, a failed connection, and retry behavior.

## Project structure

| Location | Purpose |
| --- | --- |
| `frontend/src` | React page, styles, and frontend tests |
| `backend/src` | Express application and server startup |
| `backend/tests` | API tests |
| `.github/workflows/ci.yml` | Automated CI checks |
| `eslint.config.mjs` | Static analysis configuration |
| `package-lock.json` | Exact dependency versions |

The root npm workspace configuration lets both applications share one installation command. Each application has its own package and TypeScript configuration.

## Build and deployment status

The build command writes files to `frontend/dist` and `backend/dist`. The compiled backend starts with `npm.cmd run start --workspace backend`. To check the built frontend locally, run `npm.cmd run preview --workspace frontend` in another terminal.

Production hosting and automated deployment will be added in the deployment branch. GitHub CI must be checked after the source is pushed.
