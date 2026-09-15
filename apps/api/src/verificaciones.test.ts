import { describe, expect, it } from "vitest";
import type { CandidateRow } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { asegurarVerificaciones } from "./verificaciones.js";
import type { Container } from "./container.js";

const HOY = "2026-09-15";
const fila = (symbol: string, score: number, over: Partial<CandidateRow> = {}): CandidateRow => ({
  candidateDate: HOY, symbol, kind: "stock", verdict: "COMPRAR", score, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 10,
  close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 10_000, sizeQty: 100, riskScore: 3, flags: [], nthAppearance: 1,
  summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
  close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
  verification: null, ...over,
});

function montar(verify: (s: string) => Promise<unknown>) {
  const store = new MemoryStore();
  const llamadas: string[] = [];
  const verifier = {
    promptVersion: "v-nuevo",
    verify: async ({ symbol }: { symbol: string }) => {
      llamadas.push(symbol);
      await verify(symbol);
      return { verdict: "apto" as const, reason: "ok", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "DICTAMEN: APTO — ok\nFALTANTES: ninguno", model: "m" };
    },
  };
  const c = { store, radarDeps: { store, verifier } } as unknown as Container;
  const refrescados: string[][] = [];
  return { store, c, llamadas, refrescados, refrescar: async (s: string[]) => { refrescados.push(s); } };
}

describe("verificaciones pendientes (15/9)", () => {
  it("verifica las de más convicción que no tienen la verificación vigente, de a dos, y refresca solo esas", async () => {
    // El 15/9 las verificaciones de APH, TSM y PBT fallaron por Google saturado a las 7:50, y la app esperaba al día
    // siguiente para reintentar: el plan quedaba sin acciones todo el día.
    const m = montar(async () => {});
    await m.store.upsertCandidates([fila("PBT", 2), fila("APH", 1.5), fila("TSM", 1.2), fila("VIEJA", 3, { verification: { date: HOY, verdict: "apto", reason: "x", consensusTarget: null, promptVersion: "v-nuevo" } })]);
    await asegurarVerificaciones(m.c, { hoy: HOY, ahora: () => 0, refrescar: m.refrescar });
    expect(m.llamadas).toEqual(["PBT", "APH"]);
    expect(m.refrescados).toEqual([["PBT", "APH"]]);
  });
  it("si Google falla, reintenta a los 15 minutos y no más de 6 veces por día", async () => {
    const m = montar(async () => { throw new Error("HTTP 503 high demand"); });
    await m.store.upsertCandidates([fila("PBT", 2)]);
    let t = 0;
    const ahora = () => t;
    await asegurarVerificaciones(m.c, { hoy: HOY, ahora, refrescar: m.refrescar });
    await asegurarVerificaciones(m.c, { hoy: HOY, ahora, refrescar: m.refrescar });
    expect(m.llamadas).toEqual(["PBT"]);
    for (let i = 0; i < 8; i++) { t += 16 * 60_000; await asegurarVerificaciones(m.c, { hoy: HOY, ahora, refrescar: m.refrescar }); }
    expect(m.llamadas).toHaveLength(6);
    expect(m.refrescados).toEqual([]);
  });
});
