/**
 * Base de los tests de integración (15/9). Solo para tests: no se exporta desde `index.ts`.
 *
 * Hasta el 15/9 estos tests corrían con `DATABASE_URL`, la base de la app. Uno borró el registro de uso entero (11.277
 * llamadas del 14 y el 15/9) y los otros escriben filas fechadas en 2099 que, mientras corren, son "lo último" del
 * Radar, del plan y de Cartera. Ahora usan `TEST_DATABASE_URL` (una base aparte, `thesis_test`, con las mismas
 * migraciones) y se niegan a correr contra la base de la app.
 */
export const BASE_DE_LA_APP = "thesis";

export function testDatabaseUrl(): string | null {
  const url = process.env["TEST_DATABASE_URL"] ?? null;
  if (!url) return null;
  const base = new URL(url).pathname.replace(/^\//, "");
  if (base === BASE_DE_LA_APP) throw new Error(`TEST_DATABASE_URL apunta a la base de la app (${base}): los tests de integración escriben y borran, usá thesis_test`);
  return url;
}
