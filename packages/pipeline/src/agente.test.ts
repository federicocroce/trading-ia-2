import { describe, expect, it } from "vitest";
import type { CandidateRow, ContributionPlan } from "@thesis/core";
import { AGENTE_REVISION_VERSION, AGENTE_VERSION, AgentReviewer, AgentVerifier } from "@thesis/reasoner";
import { importarDelAgente, pendientesDelAgente } from "./agente.js";
import { MemoryStore } from "./store.js";
import { reviewPending } from "./radar.js";
import { verifyFor } from "./radar-verify.js";

/*
 * 22/9: la verificación y la revisión las hace un agente de Claude por cron. El pipeline arma lo que hay que verificar
 * (el plan primero) e importa lo que el agente devuelve, decidido por regla y guardado en las tablas de siempre.
 */
const HOY = "2026-09-22";
const fila = (symbol: string, over: Partial<CandidateRow> = {}): CandidateRow => ({ candidateDate: HOY, symbol, kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 10, close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 10_000, sizeQty: 98, riskScore: 4, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, ...over });
const plan = (lineas: Array<[string, "comprar" | "nucleo" | "sumar" | "seguimiento"]>, extra: Partial<ContributionPlan> = {}): ContributionPlan => ({ month: "2026-09", totalUsd: 40_000, lines: lineas.map(([symbol, kind]) => ({ symbol, kind, amountUsd: 1000, rationale: "", close: 100, spyClose: null, alpha30dPct: null, alpha90dPct: null, stop: kind === "nucleo" ? null : 90 })), notes: [], ...extra });
const deps = (store: MemoryStore) => ({ store, verifier: new AgentVerifier(), reviewer: new AgentReviewer() });
const sec = { url: "https://www.sec.gov/Archives/edgar/data/1/x.htm", titulo: "8-K" };
const verif = (symbol: string, over: Record<string, unknown> = {}) => ({ symbol, fecha: HOY, ultimoTrimestre: null, analistas: [], consensoObjetivo: null, eventos: [], valuacion: { texto: null, metric: null, current: null, min5y: null, max5y: null, growthAccelerating: null }, proximosResultados: null, reservas: [], evitar: [], faltantes: [], fuentes: [sec], resumen: "informe", ...over });

describe("pendientesDelAgente", () => {
  it("primero las líneas del plan (sin el núcleo), después lo que el plan anotó, después las COMPRAR por convicción; con topes", async () => {
    const store = new MemoryStore();
    await store.upsertCandidates([fila("APH"), fila("CDLR"), fila("PGY", { score: 2 }), fila("FIVE", { score: 1.5 }), fila("SNDK", { flags: ["subio_mucho_12m"] }), fila("OBS", { verdict: "OBSERVAR" }), fila("QQQ", { kind: "etf" })]);
    await store.savePlan(plan([["VTI", "nucleo"], ["APH", "comprar"], ["CDLR", "comprar"]], { verificationsPending: ["FIVE"] }));
    const p = await pendientesDelAgente(deps(store), { today: HOY, topeVerificaciones: 4, topeRevisiones: 5 });
    expect(p.verificar.map((x) => x.symbol)).toEqual(["APH", "CDLR", "FIVE", "PGY"]);
    // La revisión es solo de las líneas del plan: vale por el día.
    expect(p.revisar.map((x) => x.symbol)).toEqual(["APH", "CDLR"]);
    expect(p.version).toBe(AGENTE_VERSION);
    expect(p.versionRevision).toBe(AGENTE_REVISION_VERSION);
    expect(p.cuestionario).toContain("NO escribas veredictos");
    expect(p.revisar[0]).toMatchObject({ linea: { kind: "comprar", close: 100, stop: 90 } });
  });
  it("lo ya verificado por el agente en los últimos 7 días y lo ya revisado hoy no vuelve; lo de Gemini sí", async () => {
    const store = new MemoryStore();
    await store.upsertCandidates([fila("APH"), fila("CDLR"), fila("SEZL")]);
    await store.savePlan(plan([["APH", "comprar"], ["CDLR", "comprar"], ["SEZL", "comprar"]]));
    const guardada = { verdict: "apto" as const, reason: "x", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "", model: "m", detectedAt: `${HOY}T10:00:00Z` };
    await store.saveVerification({ ...guardada, symbol: "APH", date: "2026-09-18", promptVersion: AGENTE_VERSION });
    await store.saveVerification({ ...guardada, symbol: "CDLR", date: "2026-09-20", promptVersion: "v1-8af0705a3b69-gemini" });
    await store.savePreTradeReview({ symbol: "APH", date: HOY, verdict: "sin_objeciones", reason: "x", sources: [], researchText: "", model: "m", promptVersion: AGENTE_REVISION_VERSION });
    const p = await pendientesDelAgente(deps(store), { today: HOY, topeVerificaciones: 8, topeRevisiones: 5 });
    expect(p.verificar.map((x) => x.symbol)).toEqual(["CDLR", "SEZL"]);
    expect(p.revisar.map((x) => x.symbol)).toEqual(["CDLR", "SEZL"]);
  });
  it("con símbolos pedidos a mano, son esos, en las dos listas, sin topes ni vigencia", async () => {
    const store = new MemoryStore();
    const p = await pendientesDelAgente(deps(store), { today: HOY, topeVerificaciones: 1, topeRevisiones: 1, simbolos: ["sezl", "SMCI", "AII"] });
    expect(p.verificar.map((x) => x.symbol)).toEqual(["SEZL", "SMCI", "AII"]);
    expect(p.revisar.map((x) => x.symbol)).toEqual(["SEZL", "SMCI", "AII"]);
  });
});

describe("importarDelAgente", () => {
  const opts = { hostsPrimarios: ["sec.gov"], today: HOY, version: AGENTE_VERSION, versionRevision: AGENTE_REVISION_VERSION };
  it("decide por regla, guarda con la versión del agente y la fecha de hoy, y rechaza ítem por ítem sin tirar el archivo", async () => {
    const store = new MemoryStore();
    const archivo = {
      verificaciones: [verif("ATEX", { evitar: [{ motivo: "item_unico", detalle: "sin la ganancia por venta pierde 12 M", fuente: sec }] }), verif("MALO", { reservas: [{ tipo: "valuacion", detalle: "x", fuente: { url: "", titulo: "x" } }] }), verif("CDLR")],
      revisiones: [{ symbol: "CDLR", fecha: HOY, busquedaHecha: true, motivoSinBusqueda: null, objeciones: [], fuentes: [], resumen: "" }],
    };
    const r = await importarDelAgente(store, archivo, opts);
    expect(r.verificados).toEqual([{ symbol: "ATEX", verdict: "evitar", reason: "sin la ganancia por venta pierde 12 M" }, { symbol: "CDLR", verdict: "apto", reason: "sin reservas con fuente" }]);
    expect(r.revisados).toEqual([{ symbol: "CDLR", verdict: "sin_objeciones", reason: "sin objeciones con fuente en los últimos 30 días" }]);
    expect(r.rechazados).toHaveLength(1);
    expect(r.rechazados[0]).toMatchObject({ symbol: "MALO" });
    expect(await store.verification("ATEX")).toMatchObject({ verdict: "evitar", date: HOY, promptVersion: AGENTE_VERSION, model: "claude (agente)" });
    expect(await store.preTradeReviews(HOY)).toEqual([expect.objectContaining({ symbol: "CDLR", promptVersion: AGENTE_REVISION_VERSION })]);
  });
  it("en ensayo decide igual pero no escribe nada", async () => {
    const store = new MemoryStore();
    const r = await importarDelAgente(store, { verificaciones: [verif("CDLR")], revisiones: [] }, { ...opts, ensayo: true });
    expect(r.verificados).toHaveLength(1);
    expect(await store.verification("CDLR")).toBeNull();
  });
  it("un archivo sin la forma esperada se rechaza entero, con el motivo", async () => {
    const r = await importarDelAgente(new MemoryStore(), { cosas: [] }, opts);
    expect(r.verificados).toEqual([]);
    expect(r.rechazados[0]!.motivo).toMatch(/verificaciones/);
  });
});

describe("con el agente, la app no llama al verificador ni al revisor", () => {
  it("verifyFor devuelve lo guardado sin llamar ni gastar presupuesto; reviewPending no hace nada", async () => {
    const store = new MemoryStore();
    const budget = { left: 3 };
    expect(await verifyFor({ store, verifier: new AgentVerifier() }, "APH", { today: HOY, name: null, budget })).toBeNull();
    expect(budget.left).toBe(3);
    await store.savePlan(plan([["APH", "comprar"]], { reviewsPending: ["APH"] }));
    expect(await reviewPending({ ...deps(store) } as never, { today: HOY })).toEqual({ reviewed: [], errors: [] });
    expect(await store.preTradeReviews(HOY)).toEqual([]);
  });
});
