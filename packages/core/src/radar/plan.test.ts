import { describe, expect, it } from "vitest";
import { planContribution, type EtfConfig, type PlanInput } from "../index.js";

const c = { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50, coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
const core: EtfConfig[] = [
  { symbol: "VTI", name: "VTI", role: "nucleo", exposure: "rv_us", ter: 0.03, themes: [], coreWeight: 0.6 },
  { symbol: "VEA", name: "VEA", role: "nucleo", exposure: "rv_internacional", ter: 0.05, themes: [], coreWeight: 0.25 },
  { symbol: "VWO", name: "VWO", role: "nucleo", exposure: "emergentes", ter: 0.08, themes: [], coreWeight: 0.15 },
];
const base: PlanInput = {
  month: "2026-09", portfolioValueUsd: 100_000,
  positions: [{ symbol: "TSM", valueUsd: 7_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 65_000, assetClass: "adr" }, { symbol: "GGAL", valueUsd: 28_000, assetClass: "adr" }],
  sumarCandidates: [], buyCandidates: [], coreEtfs: core, spyClose: 500, closes: { VTI: 300, VEA: 55, VWO: 48, TSM: 428, NVDA: 180, AMD: 160 },
};

describe("planContribution", () => {
  it("núcleo vacío → todo el aporte al núcleo, repartido por peso objetivo", () => {
    const p = planContribution(base, c);
    expect(p.totalUsd).toBe(6500);
    expect(p.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["VTI", "nucleo", 3900], ["VEA", "nucleo", 1625], ["VWO", "nucleo", 975]]);
    expect(p.lines[0]!.close).toBe(300);
    expect(p.lines[0]!.spyClose).toBe(500);
  });
  it("núcleo lleno → SUMAR primero (tope 50% del aporte), luego COMPRAR por score; máximo de nuevas; sobrante al núcleo", () => {
    const i: PlanInput = {
      ...base,
      positions: [{ symbol: "VTI", valueUsd: 45_000, assetClass: "etf", role: "nucleo" }, { symbol: "TSM", valueUsd: 7_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 20_000, assetClass: "adr" }, { symbol: "GGAL", valueUsd: 28_000, assetClass: "adr" }],
      sumarCandidates: [{ symbol: "TSM", valueUsd: 7_000, weightPct: 7 }],
      buyCandidates: [{ symbol: "AMD", kind: "stock", priority: 1.5, score: 1.5, sizeUsd: 9_000, close: 160 }, { symbol: "NVDA", kind: "stock", priority: 2.1, score: 2.1, sizeUsd: 14_994, close: 180 }, { symbol: "XLE", kind: "etf", priority: 1.1, score: null, sizeUsd: 5_000, close: 90 }],
    };
    // SUMAR toma hasta el 30% del resto; las nuevas se ordenan por prioridad (convicción) y respetan el máximo de nuevas (acciones + ETFs).
    const p = planContribution(i, { ...c, maxNewPositionsPerMonth: 1 });
    expect(p.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["TSM", "sumar", 1950], ["NVDA", "comprar", 3250], ["VTI", "nucleo", 780], ["VEA", "nucleo", 325], ["VWO", "nucleo", 195]]);
    const p2 = planContribution({ ...i, sumarCandidates: [] }, { ...c, maxNewPositionsPerMonth: 1 });
    expect(p2.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["NVDA", "comprar", 3250], ["VTI", "nucleo", 1950], ["VEA", "nucleo", 813], ["VWO", "nucleo", 487]]);
    expect(p2.notes.join(" ")).toMatch(/AMD \(2° por convicción: tope de 1 posiciones nuevas\)/);
  });
  it("un monto grande con el núcleo vacío: 60% al núcleo, SUMAR hasta 30% del resto, nuevas por convicción repartidas parejo, una de seguimiento, ticket completo", () => {
    const i: PlanInput = {
      ...base,
      portfolioValueUsd: 158_000,
      positions: [{ symbol: "GGAL", valueUsd: 40_000, assetClass: "adr" }, { symbol: "PAM", valueUsd: 31_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 29_000, assetClass: "adr" }, { symbol: "VIST", valueUsd: 17_000, assetClass: "adr" }, { symbol: "HUT", valueUsd: 14_400, assetClass: "accion_us" }, { symbol: "TSM", valueUsd: 11_600, assetClass: "accion_us" }, { symbol: "MARA", valueUsd: 7_500, assetClass: "accion_us" }, { symbol: "NEM", valueUsd: 5_800, assetClass: "accion_us" }],
      sumarCandidates: [{ symbol: "TSM", valueUsd: 11_600, weightPct: 7.4 }, { symbol: "NEM", valueUsd: 5_800, weightPct: 3.7, stop: 118.5, target: 152.4 }],
      buyCandidates: [
        { symbol: "NVDA", kind: "stock", priority: 1.49, score: 1.29, sizeUsd: 15_661, close: 225.79, entryHigh: 230.31, stop: 214.15, target: 249.07 },
        { symbol: "NBN", kind: "stock", priority: 1.54, score: 1.14, sizeUsd: 15_729, close: 131.8, entryHigh: 134.44, stop: 128.13, target: 139.14 },
        { symbol: "ZVRA", kind: "stock", priority: 1.73, score: 1.33, sizeUsd: 15_336, close: 12.67, entryHigh: 12.92, stop: 11.59, target: 14.83 },
        { symbol: "COPX", kind: "etf", priority: 1.96, score: null, sizeUsd: null, close: 94.84 },
        { symbol: "CEG", kind: "watch", priority: -2, score: 0.06, sizeUsd: 15_685, close: 301.52, entryHigh: 307.55, stop: 277.84, target: 348.88 },
        { symbol: "CRWV", kind: "watch", priority: -7, score: 0.36, sizeUsd: 15_729, close: 103.5 },
      ],
      closes: { ...base.closes, ZVRA: 12.67, NBN: 131.8, NVDA: 225.79, CEG: 301.52, COPX: 94.84, NEM: 90, CRWV: 103.5 },
    };
    const p = planContribution(i, c, { amountUsd: 40_000 });
    expect(p.totalUsd).toBe(40_000);
    // Un monto de 6 aportes admite dos posiciones nuevas extra (una por cada 3 aportes): entran las tres acciones y el ETF satélite,
    // repartidas por convicción (pieza 5), no parejo.
    expect(p.lines.map((l) => [l.symbol, l.kind])).toEqual([
      ["VTI", "nucleo"], ["VEA", "nucleo"], ["VWO", "nucleo"],
      ["NEM", "sumar"],
      ["ZVRA", "comprar"], ["NBN", "comprar"], ["NVDA", "comprar"], ["CEG", "seguimiento"], ["COPX", "comprar"],
    ]);
    expect(p.lines.slice(0, 4).map((l) => l.amountUsd)).toEqual([14_400, 6_000, 3_600, 4_800]);
    const zvraUsd = p.lines.find((l) => l.symbol === "ZVRA")!.amountUsd;
    const nvdaUsd = p.lines.find((l) => l.symbol === "NVDA")!.amountUsd;
    expect(zvraUsd).toBeGreaterThan(nvdaUsd); // más convicción, más plata
    expect(p.lines.slice(4).reduce((s, l) => s + l.amountUsd, 0)).toBe(11_200);
    // Con el aporte mensual normal, el tope sigue siendo el de la política.
    const mensual = planContribution({ ...i, closes: i.closes }, c);
    expect(mensual.lines.filter((l) => l.kind === "comprar").map((l) => l.symbol)).toEqual(["ZVRA", "NBN"]);
    // Explicabilidad: cada COMPRAR que no entró aparece en las notas con su lugar por convicción y el motivo.
    expect(mensual.notes.join("\n")).toMatch(/NVDA \(3° por convicción: tope de 2 posiciones nuevas\)/);
    expect(mensual.leftOut!.find((x) => x.symbol === "CRWV")?.reason).toMatch(/seguimiento/);
    expect(mensual.leftOut!.some((x) => x.symbol === "COPX")).toBe(true);
    for (const b of i.buyCandidates) expect(mensual.lines.some((l) => l.symbol === b.symbol) || mensual.leftOut!.some((x) => x.symbol === b.symbol)).toBe(true);
    expect(p.lines.reduce((s, l) => s + l.amountUsd, 0)).toBe(40_000);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.rationale).toMatch(/^3° por convicción de 3 COMPRAR del Radar/);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.priority).toBe(1.49);
    expect(p.lines.find((l) => l.symbol === "ZVRA")!.rationale).toMatch(/^1° por convicción de 3/);
    const nem = p.lines.find((l) => l.symbol === "NEM")!;
    expect([nem.stop, nem.target]).toEqual([118.5, 152.4]); // el stop y objetivo del veredicto de Cartera viajan a la línea SUMAR
    const zvra = p.lines.find((l) => l.symbol === "ZVRA")!;
    expect([zvra.entryHigh, zvra.stop, zvra.target]).toEqual([12.92, 11.59, 14.83]);
    expect(p.lines.some((l) => l.symbol === "COPX" && l.kind === "comprar")).toBe(true); // con 4 nuevas el ETF satélite entra
  });
  it("una salvedad del candidato (se mueve como algo tuyo) queda escrita en la razón de la línea", () => {
    const i: PlanInput = {
      ...base,
      positions: [{ symbol: "VTI", valueUsd: 45_000, assetClass: "etf", role: "nucleo" }, { symbol: "TSM", valueUsd: 7_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 20_000, assetClass: "adr" }, { symbol: "GGAL", valueUsd: 28_000, assetClass: "adr" }],
      buyCandidates: [{ symbol: "NVDA", kind: "stock", priority: 1.8, score: 2.1, sizeUsd: 14_994, close: 180, cautions: ["se mueve como TSM que ya tenés (correlación 0.81)"] }],
    };
    const p = planContribution(i, { ...c, maxNewPositionsPerMonth: 1 });
    expect(p.lines.find((l) => l.symbol === "NVDA")!.rationale).toMatch(/^1° por convicción de 1 COMPRAR del Radar, convicción 1\.8, score 2\.1 · ⚠ se mueve como TSM que ya tenés \(correlación 0\.81\)$/);
  });
  it("sin candidatos y núcleo lleno → todo al núcleo con nota", () => {
    const p = planContribution({ ...base, positions: [{ symbol: "VTI", valueUsd: 50_000, assetClass: "etf", role: "nucleo" }, { symbol: "YPF", valueUsd: 50_000, assetClass: "adr" }] }, c);
    expect(p.lines.every((l) => l.kind === "nucleo")).toBe(true);
    expect(p.lines.reduce((s, l) => s + l.amountUsd, 0)).toBe(6500);
    expect(p.notes.join(" ")).toMatch(/sin candidatos/i);
  });
  it("sin núcleo definido → sobrante queda en nota", () => {
    const p = planContribution({ ...base, coreEtfs: [] }, c);
    expect(p.lines).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/6500/);
  });
});
