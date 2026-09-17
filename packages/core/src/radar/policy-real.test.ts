import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RadarPolicySchema } from "./taxonomy.js";

/**
 * El config REAL, no un fixture. El 16/9 `maxRows` viajaba en el JSON y el esquema lo descartaba en silencio: el
 * arreglo del corte no se notaba. Y el 17/9 el informe de /mercado midió que ocho de diez finalistas quedaban entre
 * los puestos 177 y 238: con `preselect` 150 la app nunca los evaluaba (RNR 178, HG 183, ARW 185, GL 204, ESNT 212,
 * IOSP 221, ARGX 238).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const policy = RadarPolicySchema.parse(JSON.parse(readFileSync(path.join(root, "config/radar-policy.json"), "utf8")));

describe("config/radar-policy.json (el real)", () => {
  it("preselecciona al menos 300: los finalistas del 17/9 (puestos 177 a 238) entran a la evaluación", () => {
    expect(policy.candidates.preselect).toBeGreaterThanOrEqual(300);
  });
  it("mantiene el corte de 40 filas por puntaje y el tope de 80: cada fila más es una ficha del modelo", () => {
    expect(policy.candidates.top).toBe(40);
    expect(policy.candidates.maxRows).toBe(80);
  });
});
