import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// El puerto de la API sale del .env de la raíz del monorepo (PORT), igual que en apps/api.
const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const apiPort = loadEnv(mode, root, "")["PORT"] ?? "3001";
  return {
    plugins: [react()],
    server: { port: 5173, proxy: { "/api": { target: `http://localhost:${apiPort}`, rewrite: (p) => p.replace(/^\/api/, "") } } },
  };
});
