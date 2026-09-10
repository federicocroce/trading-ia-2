import { describe, expect, it } from "vitest";
import type { CandidateVerifier, VerifierResult } from "@thesis/core";
import { MemoryStore } from "./store.js";
import { VERIFY_FRESH_DAYS, verifyFor } from "./radar-verify.js";

const result = (verdict: VerifierResult["verdict"], reason = "motivo"): VerifierResult => ({ verdict, reason, lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [{ title: "sec.gov", url: "https://x" }], researchText: "informe", model: "m" });
function verifier(results: Array<VerifierResult | Error>, version = "v1-test"): CandidateVerifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    promptVersion: version,
    calls,
    async verify(i) {
      calls.push(i.symbol);
      const r = results.shift();
      if (!r) throw new Error("sin más resultados");
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe("verifyFor", () => {
  it("sin verificador devuelve null sin tocar el store", async () => {
    const store = new MemoryStore();
    expect(await verifyFor({ store }, "NVDA", { today: "2026-09-10", name: null })).toBeNull();
    expect(await store.verification("NVDA")).toBeNull();
  });
  it("verifica, guarda el informe completo y devuelve el resumen; dentro de los 7 días reusa lo guardado", async () => {
    const store = new MemoryStore();
    const v = verifier([result("apto", "limpia")]);
    const first = await verifyFor({ store, verifier: v }, "nvda", { today: "2026-09-10", name: "NVIDIA", context: "banderas: x" });
    expect(first).toEqual({ date: "2026-09-10", verdict: "apto", reason: "limpia" });
    const saved = (await store.verification("NVDA"))!;
    expect(saved).toMatchObject({ symbol: "NVDA", date: "2026-09-10", promptVersion: "v1-test", researchText: "informe", sources: [{ title: "sec.gov", url: "https://x" }] });
    expect(saved.detectedAt).toMatch(/T/);
    const again = await verifyFor({ store, verifier: v }, "NVDA", { today: `2026-09-1${VERIFY_FRESH_DAYS - 1}`, name: null });
    expect(again).toEqual(first);
    expect(v.calls).toEqual(["NVDA"]);
  });
  it("vencida (7 días) o de otra versión del prompt: vuelve a verificar", async () => {
    const store = new MemoryStore();
    const v = verifier([result("apto"), result("con_reservas", "cambió"), result("evitar")]);
    await verifyFor({ store, verifier: v }, "A", { today: "2026-09-01", name: null });
    const stale = await verifyFor({ store, verifier: v }, "A", { today: "2026-09-08", name: null });
    expect(stale?.verdict).toBe("con_reservas");
    const other = verifier([result("evitar")], "v2-otro");
    const re = await verifyFor({ store, verifier: other }, "A", { today: "2026-09-08", name: null });
    expect(re?.verdict).toBe("evitar");
    expect(v.calls).toEqual(["A", "A"]);
  });
  it("si el modelo falla: deja lo que había (aunque esté vencido) o null si nunca hubo", async () => {
    const store = new MemoryStore();
    const logs: string[] = [];
    const v = verifier([new Error("cuota")]);
    expect(await verifyFor({ store, verifier: v, log: (m) => logs.push(m) }, "B", { today: "2026-09-10", name: null })).toBeNull();
    expect(logs[0]).toContain("falló");
    await store.saveVerification({ symbol: "B", date: "2026-08-01", verdict: "apto", reason: "vieja", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "", promptVersion: "v1-test", model: null, detectedAt: "2026-08-01T00:00:00Z" });
    const v2 = verifier([new Error("cuota")]);
    expect(await verifyFor({ store, verifier: v2 }, "B", { today: "2026-09-10", name: null })).toEqual({ date: "2026-08-01", verdict: "apto", reason: "vieja" });
  });
});
