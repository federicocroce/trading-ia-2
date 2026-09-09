import { describe, expect, it } from "vitest";
import { holdingsOverlap } from "./overlap.js";
import type { Candle } from "../cartera/types.js";

const series = (closes: number[]): Candle[] => closes.map((c, i) => ({ date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, open: c, high: c, low: c, close: c, volume: 1000 }));
const walk = (n: number, start: number, step: (i: number) => number) => {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * (1 + step(i)));
  return out;
};
const ypf = series(walk(130, 100, (i) => (i % 2 ? 0.01 : -0.005)));
const twin = series(walk(130, 50, (i) => (i % 2 ? 0.02 : -0.01))); // se mueve igual que ypf, el doble
const other = series(walk(130, 100, (i) => (i % 3 === 0 ? 0.012 : -0.004))); // otro ritmo

describe("holdingsOverlap", () => {
  it("marca al candidato que se mueve como un papel que ya tenés, con el más parecido y su correlación", () => {
    const o = holdingsOverlap({ NEW: twin, OTHER: other }, { YPF: ypf, PAM: other.map((c) => ({ ...c, close: c.close * 3 })) });
    expect(o["NEW"]).toEqual({ with: "YPF", corr: 1 });
    // OTHER se mueve como PAM (misma serie escalada): también se marca, con PAM.
    expect(o["OTHER"]).toEqual({ with: "PAM", corr: 1 });
  });

  it("por debajo del umbral no marca nada", () => {
    expect(holdingsOverlap({ NEW: twin }, { PAM: other })).toEqual({});
  });

  it("con menos de 20 ruedas en común no opina, y no se compara un papel consigo mismo", () => {
    expect(holdingsOverlap({ NEW: series(twin.slice(0, 10).map((c) => c.close)) }, { YPF: ypf })).toEqual({});
    expect(holdingsOverlap({ YPF: ypf }, { YPF: ypf })).toEqual({});
  });
});
