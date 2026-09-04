import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * as schema from "./schema.js";

export function createDb(url = process.env["DATABASE_URL"]) {
  if (!url) throw new Error("DATABASE_URL no definida");
  const client = postgres(url, { max: 5 });
  return drizzle(client, { schema });
}
export type Db = ReturnType<typeof createDb>;
