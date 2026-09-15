import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CandidateVerification } from "@thesis/core";
import { Repo, createDb, schema } from "./index.js";
import { testDatabaseUrl } from "./integracion.js";

// Una base aparte, nunca la de la app (15/9: este archivo borró el registro de uso real). Ver `integracion.ts`.
const url = testDatabaseUrl();
const d = url ? describe : describe.skip;

d("Repo: verificación web (Postgres real)", () => {
  const db = (url ? createDb(url) : null) as ReturnType<typeof createDb>;
  const repo = new Repo(db);
  const sym = `V${randomUUID().slice(0, 4).toUpperCase()}`;
  afterAll(async () => {
    await db.delete(schema.radarVerifications).where(eq(schema.radarVerifications.symbol, sym));
    await db.delete(schema.radarCandidates).where(eq(schema.radarCandidates.symbol, sym));
  });
  it("guarda y lee la verificación completa (upsert por símbolo) y la fila del candidato lleva el resumen", async () => {
    const v: CandidateVerification = { symbol: sym, date: "2099-01-05", verdict: "con_reservas", reason: "reservas liberadas", lastQuarter: { reportDate: "2099-01-01", revenueVsConsensus: "x", epsVsConsensus: null, oneOffs: ["a"], guidance: null }, analysts: [{ date: "2099-01-02", firm: "F", action: "sube", target: 12.5 }], consensusTarget: 13.25, events: [], valuation: "v", nextEarnings: "2099-02-01", sources: [{ title: "t", url: "u" }], researchText: "informe", promptVersion: "v1-x", model: "m", detectedAt: "2099-01-05T10:00:00.000Z" };
    await repo.saveVerification(v);
    await repo.saveVerification({ ...v, verdict: "apto", reason: "cambió" });
    const read = (await repo.verification(sym))!;
    expect(read).toEqual({ ...v, verdict: "apto", reason: "cambió" });
    await repo.upsertCandidates([{ candidateDate: "2099-01-05", symbol: sym, kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 5, close: 10, entryLow: 10, entryHigh: 10.2, stop: 9, target: 12, sizeUsd: null, sizeQty: null, riskScore: 3, flags: ["verificacion_apta"], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, verification: { date: "2099-01-05", verdict: "apto", reason: "cambió" } }]);
    const rows = await repo.candidatesForDate("2099-01-05");
    expect(rows.find((r) => r.symbol === sym)?.verification).toEqual({ date: "2099-01-05", verdict: "apto", reason: "cambió" });
  });
});
