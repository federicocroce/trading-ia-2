import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://thesis:thesis@localhost:5433/thesis",
  },
  strict: true,
  verbose: true,
});
