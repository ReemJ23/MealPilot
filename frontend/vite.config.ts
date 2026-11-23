import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The browser uses /api and Vite forwards those requests to Express.
const proxy = { "/api": "http://127.0.0.1:3000" };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
  },
});
