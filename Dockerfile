# Build both existing workspaces using the repository's locked dependency versions.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
COPY frontend frontend
COPY database database
RUN npm run build

# The runtime contains only compiled code and production dependencies.
FROM node:24-bookworm-slim
ENV NODE_ENV=production SERVE_FRONTEND=true PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY database/schema.sql database/schema.sql
USER node
EXPOSE 3000
# Database setup is idempotent and creates only missing tables.
CMD ["sh", "-c", "node --input-type=module -e 'import {initializeDatabase} from \"./backend/dist/database.js\"; await initializeDatabase()' && node backend/dist/server.js"]
