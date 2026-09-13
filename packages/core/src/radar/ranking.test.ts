import { describe, expect, it } from "vitest";
import { groupMedians, peerGroup, rankStocks, robustZ, unreliableGrowthKeys, type Fundamentals } from "./index.js";

const weights = { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 };
const base = { peTTM: 20, evEbitdaTTM: 12, psTTM: 3, roeTTM: 15, operatingMarginTTM: 20, netProfitMarginTTM: 12, revenueGrowthTTMYoy: 10, revenueGrowth5Y: 8, epsGrowthTTMYoy: 10, "totalDebt/totalEquityAnnual": 0.5, currentRatioAnnual: 1.5 };
const mk = (symbol: string, industry: string | null, metrics: Record<string, number | null>, peers: string[] = []): Fundamentals => ({
  symbol, asOf: "2026-09-07", metrics, peers, industry, mcapUsd: 1e9, dollarVolumeUsd: 1e7, priceUsd: 10, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null,
});
const vary = (i: number) => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * (1 + 0.03 * (i - 2))]));
const better = { peTTM: 10, evEbitdaTTM: 6, psTTM: 1.5, roeTTM: 30, operatingMarginTTM: 40, netProfitMarginTTM: 24, revenueGrowthTTMYoy: 20, revenueGrowth5Y: 16, epsGrowthTTMYoy: 20, "totalDebt/totalEquityAnnual": 0.25, currentRatioAnnual: 3 };
const worse = { peTTM: 40, evEbitdaTTM: 24, psTTM: 6, roeTTM: 7, operatingMarginTTM: 10, netProfitMarginTTM: 6, revenueGrowthTTMYoy: 2, revenueGrowth5Y: 1, epsGrowthTTMYoy: -5, "totalDebt/totalEquityAnnual": 1.5, currentRatioAnnual: 0.8 };

const semis = ["C1", "C2", "C3", "C4", "C5"];
const all = new Map<string, Fundamentals>([
  ["A", mk("A", "Semis", better, ["B", ...semis])],
  ["B", mk("B", "Semis", worse, ["A", ...semis])],
  ...semis.map((s, i) => [s, mk(s, "Semis", vary(i), ["A", "B", ...semis.filter((x) => x !== s)])] as [string, Fundamentals]),
  ["D", mk("D", "Semis", base, ["X", "Y"])], // pares fuera del universo → industria
  ["E", mk("E", "Rara", base, [])], // sin pares ni industria
  ["F", mk("F", "Semis", { ...base, peTTM: -5, evEbitdaTTM: null, psTTM: null }, ["A", "B", ...semis])], // sin valuación
  ["G", mk("G", "Semis", { roeTTM: 10 }, ["A", "B", ...semis])], // un solo eje
]);

describe("robustZ", () => {
  it("winsoriza a ±3 y conserva nulls", () => {
    const z = robustZ([1, 2, 3, 4, 100]);
    expect(z[4]).toBe(3);
    expect(z[2]).toBeCloseTo(0, 6);
    expect(robustZ([1, null, 3])).toEqual([expect.any(Number), null, expect.any(Number)]);
  });
  it("MAD cero → todos cero", () => expect(robustZ([5, 5, 5])).toEqual([0, 0, 0]));
});

describe("peerGroup", () => {
  it("pares dentro del universo; industria si hay pocos; null si nada", () => {
    expect(peerGroup("A", all)!.basis).toBe("pares");
    expect(peerGroup("A", all)!.members).not.toContain("A");
    expect(peerGroup("D", all)!.basis).toBe("industria");
    expect(peerGroup("E", all)).toBeNull();
  });
});

describe("rankStocks", () => {
  const { ranked, skipped } = rankStocks(all, weights);
  const by = (s: string) => ranked.find((r) => r.symbol === s)!;
  it("mejor en todo rankea primero con score positivo; peor en todo, negativo", () => {
    expect(by("A").score).toBeGreaterThan(0);
    expect(by("A").rankInGroup).toBe(1);
    expect(by("B").score).toBeLessThan(0);
    expect(ranked[0]!.symbol).toBe("A");
    expect(by("A").axes.valuation).toBeGreaterThan(0);
    expect(by("A").medians["peTTM"]).toBeCloseTo(20, 0);
  });
  it("sin pares → sin_pares; un solo eje → ejes_insuficientes", () => {
    expect(skipped).toContainEqual({ symbol: "E", reason: "sin_pares" });
    expect(skipped).toContainEqual({ symbol: "G", reason: "ejes_insuficientes" });
  });
  it("sin valuación rankea con tres ejes reponderados", () => {
    expect(by("F").axes.valuation).toBeNull();
    expect(by("F").score).not.toBeNaN();
  });
  it("orden final por score descendente", () => {
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
  });
});

/**
 * APH el 13/9. La tabla de comparables recalculaba la mediana en el navegador EXCLUYENDO a la propia empresa
 * y sin descartar los P/E no positivos: mostraba "mediana del grupo (8)" y un P/E de 67,3×, cuando el puntaje
 * usaba 66,0× sobre nueve. Estos son los P/E reales de ese día.
 */
describe("crecimiento de ingresos no confiable en bancos (NBN, 13/9)", () => {
  // NBN era 1° por convicción con ingresos +124% TTM y +133% trimestral según Finnhub; el comunicado dice +4%.
  // Contra la base del 13/9 el problema es de la fuente con los bancos, no de NBN: TFC +58%, AMTB +78%, MBWM +59%,
  // JPM +109%, cuando un banco crece de 0 a 15%. Y una regla "más de 100% sin estados" marcaba además a NBIS
  // (+488%), APLD (+365%) y ASTS, que crecen de verdad: por eso la regla es por industria y no por umbral.
  const bancos = ["B1", "B2", "B3", "B4", "B5"];
  const banco = (i: number) => ({ ...base, revenueGrowthTTMYoy: 8 + i, revenueGrowthQuarterlyYoy: 9 + i, revenueGrowth5Y: 7 + i, epsGrowthTTMYoy: 10 + i });
  // Los dos números rotos son los reales; 5 años y EPS quedan cerca de los pares para que el efecto se vea (con
  // los reales, 21,87 y 26,41, también saturan en +3 en un grupo de seis y el eje no puede subir más).
  const nbn = { ...base, revenueGrowthTTMYoy: 123.89, revenueGrowthQuarterlyYoy: 133.39, revenueGrowth5Y: 11, epsGrowthTTMYoy: 12 };
  const grupo = (f: Fundamentals) => new Map<string, Fundamentals>([["NBN", f], ...bancos.map((s, i) => [s, mk(s, "Banking", banco(i), ["NBN", ...bancos.filter((x) => x !== s)])] as [string, Fundamentals])]);
  const growth = (f: Fundamentals) => rankStocks(grupo(f), weights).ranked.find((r) => r.symbol === "NBN")!.axes.growth!;

  it("en un banco, el crecimiento de ingresos de Finnhub no entra al eje (el de 5 años y el de EPS sí)", () => {
    const roto = mk("NBN", "Banking", nbn, bancos);
    const sinEsos = mk("NBN", "Banking", { ...nbn, revenueGrowthTTMYoy: null, revenueGrowthQuarterlyYoy: null }, bancos);
    expect(unreliableGrowthKeys(roto)).toEqual(["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"]);
    expect(growth(roto)).toBeCloseTo(growth(sinEsos), 4);
  });
  it("fuera de los bancos no cambia nada, ni siquiera con crecimientos enormes (NBIS +488%, sin estados)", () => {
    expect(unreliableGrowthKeys(mk("NBIS", "Technology", { ...base, revenueGrowthTTMYoy: 488.2, revenueGrowthQuarterlyYoy: 454 }))).toEqual([]);
  });
});

describe("groupMedians", () => {
  const pe = (v: number | null) => ({ metrics: { peTTM: v } as Record<string, number | null> });
  const aph = pe(39.7);
  const pares = [pe(70.0), pe(68.6), pe(null), pe(66.0), pe(19.6), pe(null), pe(44.9), pe(73.0)];

  it("incluye a la propia empresa: es la mediana contra la que el puntaje la mide", () => {
    expect(groupMedians([aph, ...pares])["peTTM"]).toBe(66.0);
  });

  it("sin la propia daba otro número, que era el que mostraba la pantalla", () => {
    expect(groupMedians(pares)["peTTM"]).toBeCloseTo(67.3, 1);
  });

  it("un P/E negativo no es barato, es no ganar plata: no entra en la mediana", () => {
    expect(groupMedians([pe(10), pe(20), pe(-500)])["peTTM"]).toBe(15);
  });
});

