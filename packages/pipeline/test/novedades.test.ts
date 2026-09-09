import { describe, expect, it } from "vitest";
import type { CandidateRow, VerdictRow } from "@thesis/core";
import { MemoryStore, buildNovedades } from "../src/index.js";

const verdict = (date: string, symbol: string, verb: VerdictRow["verb"], reason = "r"): VerdictRow => ({ verdictDate: date, symbol, verb, reason, narrative: null, warning: null, close: 10, spot: 10, stop: 9, target: 12, gainPct: 0, weightPct: 5, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null });
const cand = (date: string, symbol: string, verdict: CandidateRow["verdict"], kind: CandidateRow["kind"] = "stock"): CandidateRow => ({ candidateDate: date, symbol, kind, verdict, score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 5, close: 10, entryLow: 10, entryHigh: 10.2, stop: 9, target: 12, sizeUsd: 1000, sizeQty: 100, riskScore: 3, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: 500, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });

describe("buildNovedades", () => {
  it("qué cambió hoy contra la corrida anterior: veredictos, alertas, COMPRAR que entran y salen, seguimiento resuelto, tesis propuestas y noticias de lo tuyo", async () => {
    const store = new MemoryStore();
    await store.upsertPosition({ symbol: "YPF", quantity: 10, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null });
    await store.upsertVerdicts([verdict("2026-09-07", "YPF", "MANTENER"), verdict("2026-09-07", "NEM", "MANTENER"), verdict("2026-09-07", "MARA", "SUMAR")]);
    await store.upsertVerdicts([verdict("2026-09-08", "YPF", "REVISAR", "sin precio"), verdict("2026-09-08", "NEM", "SUMAR", "subponderada"), verdict("2026-09-08", "MARA", "MANTENER")]);
    await store.upsertCandidates([cand("2026-09-07", "ALL", "COMPRAR"), cand("2026-09-07", "NVDA", "COMPRAR"), cand("2026-09-07", "VTI", "NUCLEO", "etf")]);
    await store.upsertCandidates([cand("2026-09-08", "ALL", "OBSERVAR"), cand("2026-09-08", "NVDA", "COMPRAR"), cand("2026-09-08", "SEZL", "COMPRAR"), cand("2026-09-08", "VTI", "NUCLEO", "etf"), cand("2026-09-08", "GGAL.BA", "COMPRAR", "ar")]);
    await store.addWatch("MP", { entryPrice: 60, stopLoss: 50, targetPrice: 80 });
    await store.updateWatchEval("MP", { status: "invalidated", lastPrice: 49, lastReturn: -18.33, lastEvaluatedAt: "2026-09-08T12:00:00Z", resolvedAt: "2026-09-08T12:00:00Z", resolutionPrice: 49, resolutionReturn: -18.33 });
    await store.addWatch("VST", { entryPrice: 150 });
    const [ev] = await store.insertRawEvents([{ id: "e1", ticker: "YPF", eventType: "operational", source: "edgar", eventDate: "2026-09-20", sourceRef: "r", title: "Form 4", payload: {}, observedAt: "2026-09-08T00:00:00Z" }]);
    await store.ensurePromptVersion("v-test", "x");
    await store.insertThesis(ev!.id, { ticker: "YPF", eventType: "operational", eventDate: "2026-09-20", direction: "long", pEstimate: 0.7, pMarket: 0.5, instrument: "stock", entryMax: 31, target: 35, invalidation: "Si el precio cierra por debajo de 28 antes del evento.", confidence: "med", reasoning: "Compras de insiders concentradas en la cúpula de YPF durante la primera semana de septiembre.", sources: ["s"] }, "v-test", 0.1);
    await store.upsertNews([{ symbol: "YPF", date: "2026-09-08", headline: "YPF recompra deuda", source: "R", url: "https://n/1", summary: null }, { symbol: "YPF", date: "2026-08-01", headline: "vieja", source: null, url: "https://n/old", summary: null }, { symbol: "NVDA", date: "2026-09-08", headline: "no es tuya", source: null, url: "https://n/2", summary: null }]);
    await store.savePlan({ month: "2026-09", totalUsd: 1000, lines: [{ symbol: "NVDA", kind: "comprar", amountUsd: 1000, rationale: "r", close: 10, spyClose: 500, alpha30dPct: null, alpha90dPct: null }], notes: [] });

    const n = await buildNovedades(store, { today: "2026-09-08" });
    expect(n.date).toBe("2026-09-08");
    expect(n.previousDate).toBe("2026-09-07");
    expect(n.verdictChanges).toEqual([{ symbol: "MARA", from: "SUMAR", to: "MANTENER", reason: "r" }, { symbol: "NEM", from: "MANTENER", to: "SUMAR", reason: "subponderada" }, { symbol: "YPF", from: "MANTENER", to: "REVISAR", reason: "sin precio" }]);
    expect(n.alerts.map((a) => `${a.symbol}:${a.verb}`)).toEqual(["YPF:REVISAR"]);
    expect(n.enteredBuy.map((x) => x.symbol)).toEqual(["SEZL"]); // GGAL.BA es de otra familia: no cuenta
    expect(n.leftBuy).toEqual([{ symbol: "ALL", kind: "stock", now: "OBSERVAR" }]);
    expect(n.watchResolved).toEqual([{ symbol: "MP", status: "invalidated", returnPct: -18.33 }]);
    expect(n.proposedTheses.map((t) => [t.ticker, t.direction, t.edge > 0])).toEqual([["YPF", "long", true]]);
    // Noticias de hoy y ayer solo de lo tuyo: posiciones y líneas del plan.
    expect(n.news.map((x) => `${x.symbol}:${x.headline}`).sort()).toEqual(["NVDA:no es tuya", "YPF:YPF recompra deuda"]);
    expect(n.empty).toBe(false);
  });
  it("sin corrida previa ni cambios: vacío y lo dice", async () => {
    const store = new MemoryStore();
    const n = await buildNovedades(store, { today: "2026-09-08" });
    expect(n).toMatchObject({ date: null, previousDate: null, verdictChanges: [], enteredBuy: [], leftBuy: [], watchResolved: [], proposedTheses: [], news: [], empty: true });
  });
});
