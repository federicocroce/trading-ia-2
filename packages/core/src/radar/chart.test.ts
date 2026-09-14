import { describe, expect, it } from "vitest";
import { sessionBarFrom } from "./chart.js";
import type { ChartBar } from "./types.js";

// Barras de 5 minutos de APH del 14/9 (lo que devuelve Yahoo con range=1d): 13:30Z es la apertura de Nueva York.
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const b = (iso: string, open: number, high: number, low: number, close: number, volume = 100): ChartBar => ({ time: t(iso), open, high, low, close, volume });
const aph = [
  b("2026-09-14T13:30:00Z", 81.2, 81.6, 80.9, 81.0),
  b("2026-09-14T13:35:00Z", 81.0, 81.1, 79.5, 79.6),
  b("2026-09-14T15:00:00Z", 79.6, 79.9, 78.36, 78.9),
  b("2026-09-14T17:05:00Z", 78.9, 79.2, 78.8, 79.11, 300),
];

describe("sessionBarFrom", () => {
  it("APH el 14/9: el gráfico diario terminaba en el 11/9 (83,92) y el precio ya estaba en 79; la sesión de hoy entra como vela parcial", () => {
    const v = sessionBarFrom(aph, "2026-09-11")!;
    expect(v.time).toBe(t("2026-09-14T00:00:00Z"));
    expect([v.open, v.high, v.low, v.close, v.volume]).toEqual([81.2, 81.6, 78.36, 79.11, 600]);
    expect(v.partial).toBe(true);
  });
  it("si la base ya tiene esa sesión, no agrega nada", () => {
    expect(sessionBarFrom(aph, "2026-09-14")).toBeNull();
  });
  it("con sesiones de más de un día (fin de semana, 5d), toma solo la última", () => {
    const viernes = b("2026-09-11T19:55:00Z", 84.0, 84.48, 83.9, 83.92);
    const v = sessionBarFrom([viernes, ...aph], "2026-09-10")!;
    expect(v.time).toBe(t("2026-09-14T00:00:00Z"));
    expect(v.open).toBe(81.2);
  });
  it("sin barras, o con barras que no traen precio, no inventa una vela", () => {
    expect(sessionBarFrom([], "2026-09-11")).toBeNull();
    expect(sessionBarFrom([{ time: t("2026-09-14T13:30:00Z"), open: Number.NaN, high: Number.NaN, low: Number.NaN, close: Number.NaN, volume: 0 }], "2026-09-11")).toBeNull();
  });
});
