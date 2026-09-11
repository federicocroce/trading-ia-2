import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFlags, buildQuarters, coreEarnings, decideCandidate, positionSize, riskScore, technicalGate, type Candle, type CompanyFactsJson, type Fundamentals } from "../index.js";

const series = (closes: number[], start = "2025-09-01", volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume }));
const up = series(Array.from({ length: 260 }, (_, i) => 80 + (20 * i) / 259)); // 80 → 100, última 2026-05-18
const today = "2026-05-19";
const tech = { maxReturn21dPct: 15, earningsWithinDays: 10 };
const sizing = { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 };
const f = (over: Partial<Fundamentals> = {}): Fundamentals => ({ symbol: "X", asOf: today, metrics: { beta: 1, "totalDebt/totalEquityAnnual": 0.5, dividendYieldIndicatedAnnual: 1 }, peers: [], industry: "I", mcapUsd: 20e9, dollarVolumeUsd: 50e6, priceUsd: 100, nextEarnings: null, insiderBuys90d: 0, insiderSells90d: 0, analyst: null, earningsSurprises: null, ...over });

describe("technicalGate", () => {
  it("normal → ok con sma200, retorno 21 y atr", () => {
    const g = technicalGate(up, tech, null, today);
    expect(g.status).toBe("ok");
    expect(g.sma200).toBeLessThan(g.close);
    expect(g.return21dPct).toBeCloseTo(1.6, 0);
    expect(g.atrPct).toBeGreaterThan(0);
  });
  it("bajo SMA200 → excluido", () => {
    const down = series(Array.from({ length: 260 }, (_, i) => 100 - (20 * i) / 259));
    expect(technicalGate(down, tech, null, today)).toMatchObject({ status: "excluido", reasons: ["bajo_sma200"] });
  });
  it("subió > 15% en 21 velas → observar no_perseguir", () => {
    const spike = [...up.slice(0, 239), ...series(Array(21).fill(125), up[239]!.date)];
    expect(technicalGate(spike, tech, null, today)).toMatchObject({ status: "observar", reasons: ["no_perseguir"] });
  });
  it("resultados en ≤ 10 días → observar resultados_cerca", () => {
    expect(technicalGate(up, tech, "2026-05-25", today)).toMatchObject({ status: "observar", reasons: ["resultados_cerca"] });
    expect(technicalGate(up, tech, "2026-07-01", today).status).toBe("ok");
  });
  it("< 200 velas → excluido sin_historial", () => {
    expect(technicalGate(up.slice(-100), tech, null, today)).toMatchObject({ status: "excluido", reasons: ["sin_historial"] });
  });
});

describe("positionSize", () => {
  it("1% de riesgo entre entrada y stop, con tope del 10% de la cartera", () => {
    expect(positionSize({ entryHigh: 102, stop: 92, portfolioUsd: 150_000 }, sizing)).toEqual({ qty: 147, sizeUsd: 14_994, riskUsd: 1_500 });
    expect(positionSize({ entryHigh: 102, stop: 100, portfolioUsd: 150_000 }, sizing)).toEqual({ qty: 147, sizeUsd: 14_994, riskUsd: 1_500 });
  });
  it("sin stop o stop ≥ entrada → null; sin cartera usa el fallback", () => {
    expect(positionSize({ entryHigh: 102, stop: null, portfolioUsd: 150_000 }, sizing)).toBeNull();
    expect(positionSize({ entryHigh: 102, stop: 102, portfolioUsd: 150_000 }, sizing)).toBeNull();
    expect(positionSize({ entryHigh: 102, stop: 92, portfolioUsd: null }, sizing)!.riskUsd).toBe(1_500);
  });
});

describe("riskScore", () => {
  it("todo bajo → 1; todo alto → 10 (tope)", () => {
    expect(riskScore({ beta: 0.8, atrPct: 1.5, debtToEquity: 0.3, dollarVolumeUsd: 100e6, mcapUsd: 50e9 })).toBe(1);
    expect(riskScore({ beta: 2, atrPct: 5, debtToEquity: 2, dollarVolumeUsd: 6e6, mcapUsd: 1e9 })).toBe(10);
    expect(riskScore({ beta: 1.3, atrPct: 3, debtToEquity: 1, dollarVolumeUsd: 20e6, mcapUsd: 5e9 })).toBe(6);
    expect(riskScore({ beta: null, atrPct: null, debtToEquity: null, dollarVolumeUsd: 100e6, mcapUsd: 50e9 })).toBe(1);
    expect(riskScore({ beta: null, atrPct: null, debtToEquity: null, dollarVolumeUsd: 100e6, mcapUsd: null })).toBe(3); // capitalización desconocida (ADR) cuenta como chica
  });
});

describe("buildFlags", () => {
  const gate = technicalGate(up, tech, null, today);
  it("cada bandera con su caso", () => {
    expect(buildFlags(f({ insiderBuys90d: 2 }), gate, 1, 4)).toContain("insiders_compran");
    expect(buildFlags(f({ insiderSells90d: 3 }), gate, 1, 4)).toContain("insiders_venden");
    expect(buildFlags(f({ analyst: { strongBuy: 5, buy: 5, hold: 2, sell: 0, strongSell: 0, period: "p" } }), gate, 1, 4)).toContain("consenso_compra");
    expect(buildFlags(f({ analyst: { strongBuy: 0, buy: 1, hold: 2, sell: 3, strongSell: 2, period: "p" } }), gate, 1, 4)).toContain("consenso_venta");
    expect(buildFlags(f({ earningsSurprises: [{ period: "q", surprisePercent: 8 }] }), gate, 1, 4)).toContain("sorpresa_positiva");
    expect(buildFlags(f({ earningsSurprises: [{ period: "q", surprisePercent: -8 }] }), gate, 1, 4)).toContain("sorpresa_negativa");
    expect(buildFlags(f({ metrics: { dividendYieldIndicatedAnnual: 3 } }), gate, 1, 4)).toContain("dividendo");
    expect(buildFlags(f(), gate, 4, 4)).toContain("residente_cronico");
    expect(buildFlags(f(), gate, 1, 4)).toEqual([]);
  });
});

describe("decideCandidate", () => {
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("normal → COMPRAR con entrada, stop, objetivo, tamaño y riesgo", () => {
    const d = decideCandidate({ f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.verdict).toBe("COMPRAR");
    expect(d.entryLow).toBe(100);
    expect(d.entryHigh).toBe(102);
    // El precio de entrada ya no es un 2% inventado: sale del momento de entrada y coincide con él.
    expect(d.entry!.state).toBe("en_zona");
    expect(d.entry!.level).toBe(d.entryHigh);
    expect(d.stop).toBeLessThan(100);
    expect(d.target).toBeGreaterThan(100);
    expect(d.size!.qty).toBeGreaterThan(0);
    expect(d.riskScore).toBeGreaterThanOrEqual(1);
  });
  it("cierre bajo el stop dinámico (viene cayendo desde un máximo reciente) → OBSERVAR sin tamaño", () => {
    // sube 80→110 y en las últimas 5 velas cae a 100: sigue sobre la SMA200 pero bajo el chandelier
    const closes = [...Array.from({ length: 255 }, (_, i) => 80 + (30 * i) / 254), 108, 105, 103, 101, 100];
    const c = series(closes);
    const d = decideCandidate({ f: f(), candles: c, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.stop).toBeGreaterThan(100); // el stop quedó arriba del cierre: la tendencia se dio vuelta
    expect(d.verdict).toBe("OBSERVAR");
    // Cayó bajo su media de 50: no se compra la caída, se espera que recupere el máximo reciente.
    expect(d.entry!.state).toBe("esperar_confirmacion");
    expect(d.entryLow).toBeGreaterThan(100);
    expect(d.flags).toContain("bajo_stop");
    expect(d.size).toBeNull();
    expect(d.target).toBeNull();
  });
  it("residente crónico → OBSERVAR", () => {
    const d = decideCandidate({ f: f(), candles: up, nthAppearance: 4, portfolioUsd: null, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.flags).toContain("residente_cronico");
  });
  it("bajo SMA200 → excluido", () => {
    const down = series(Array.from({ length: 260 }, (_, i) => 100 - (20 * i) / 259));
    expect(decideCandidate({ f: f(), candles: down, nthAppearance: 1, portfolioUsd: null, today }, policy)).toEqual({ excluded: true, reasons: ["bajo_sma200"] });
  });
});

describe("decideCandidate con estados", () => {
  const zvra = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8")) as CompanyFactsJson;
  const core = coreEarnings(buildQuarters(zvra));
  const base = { candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("desvío > 25% → resultado_extraordinario; sigue COMPRAR", () => {
    const d = decideCandidate({ f: f(), ...base, core }, policy);
    expect("excluded" in d).toBe(false);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("COMPRAR");
      expect(d.flags).toContain("resultado_extraordinario");
    }
  });
  it("core null → sin_estados; undefined → ninguna de las dos", () => {
    const a = decideCandidate({ f: f(), ...base, core: null }, policy);
    const b = decideCandidate({ f: f(), ...base }, policy);
    if (!("excluded" in a)) expect(a.flags).toContain("sin_estados");
    if (!("excluded" in b)) expect(b.flags).not.toEqual(expect.arrayContaining(["sin_estados", "resultado_extraordinario"]));
  });
  it("desvío chico → sin bandera", () => {
    const d = decideCandidate({ f: f(), ...base, core: { ...core!, deviationPct: 0.1 } }, policy);
    if (!("excluded" in d)) expect(d.flags).not.toContain("resultado_extraordinario");
  });
});

describe("decideCandidate con eventos", () => {
  const base = { f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  const ev = (date: string, severity: "grave" | "moderado" | "ruido") => ({ date, kind: "regulatorio" as const, severity, headline: `evento ${severity}` });
  it("grave en 90 días → OBSERVAR con motivo evento_grave", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-04-01", "grave")] }, policy);
    expect(d).toMatchObject({ verdict: "OBSERVAR", reasons: ["evento_grave"] });
    if (!("excluded" in d)) expect(d.flags).toContain("evento_grave");
  });
  it("grave de hace 91 días ya no cuenta", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-02-17", "grave")] }, policy); // today 2026-05-19
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) expect(d.flags).not.toContain("evento_grave");
  });
  it("moderado → sigue COMPRAR con bandera; ruido no deja bandera", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-05-01", "moderado"), ev("2026-05-02", "ruido")] }, policy);
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) {
      expect(d.flags).toContain("evento_moderado");
      expect(d.flags).not.toContain("evento_grave");
    }
  });
  it("sin clasificar → bandera eventos_sin_clasificar, sigue COMPRAR", () => {
    const d = decideCandidate({ ...base, eventsUnclassified: true }, policy);
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) expect(d.flags).toContain("eventos_sin_clasificar");
  });
});
