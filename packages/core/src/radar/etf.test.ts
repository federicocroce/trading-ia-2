import { describe, expect, it } from "vitest";
import { decideEtf, relativeStrength, type Candle, type EtfConfig } from "../index.js";

const series = (closes: number[], start = "2025-09-01"): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));
const ramp = (from: number, to: number, n = 260) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
const spy = series(ramp(100, 110));
const strong = series(ramp(100, 130));
const weak = series(ramp(100, 100));
const tech = { maxReturn21dPct: 15, earningsWithinDays: 10 };
const cfg = (role: EtfConfig["role"]): EtfConfig => ({ symbol: "X", name: "X", role, exposure: "rv_us", ter: 0.1, themes: [] });

describe("relativeStrength", () => {
  it("(1+r_etf)/(1+r_spy) − 1 en %", () => {
    const etf = series([100, 110]);
    const s = series([100, 105]);
    expect(relativeStrength(etf, s, 1)).toBeCloseTo(4.7619, 3);
    expect(relativeStrength(etf, s, 5)).toBeNull();
  });
});

describe("decideEtf", () => {
  it("núcleo → NUCLEO siempre, sin stop ni objetivo: se compra por calendario y se mantiene", () => {
    const d = decideEtf(cfg("nucleo"), weak, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.verdict).toBe("NUCLEO");
    expect(d.rs6m).toBeLessThan(0);
    expect(d.stop).toBeNull();
    expect(d.target).toBeNull();
  });
  it("satélite que cierra bajo su stop dinámico → OBSERVAR con bajo_stop y sin objetivo (nunca un objetivo por debajo del precio)", () => {
    // Sube fuerte y en las últimas ruedas cae: el stop chandelier queda por encima del cierre.
    const falling = series([...ramp(100, 140, 240), ...ramp(140, 118, 20)]);
    const d = decideEtf(cfg("satelite"), falling, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.stop).not.toBeNull();
    expect(d.stop!).toBeGreaterThan(d.close);
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.reasons).toContain("bajo_stop");
    expect(d.target).toBeNull();
  });
  it("satélite fuerte, sobre SMA200 y sin perseguir → COMPRAR", () => {
    const d = decideEtf(cfg("satelite"), strong, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.verdict).toBe("COMPRAR");
    expect(d.rs6m).toBeGreaterThan(0);
    expect(d.stop).toBeLessThan(d.close);
  });
  it("satélite débil → OBSERVAR con motivo", () => {
    const d = decideEtf(cfg("satelite"), weak, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.reasons.join()).toMatch(/fuerza relativa/);
  });
  it("sin velas suficientes → excluido", () => {
    expect(decideEtf(cfg("satelite"), strong.slice(-50), spy, tech)).toEqual({ excluded: true, reasons: ["sin_historial"] });
  });
});
