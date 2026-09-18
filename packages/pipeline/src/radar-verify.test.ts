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
    // La versión del cuestionario viaja con el resumen: el plan solo acepta lo verificado con el cuestionario vigente (13/9).
    expect(first).toEqual({ date: "2026-09-10", verdict: "apto", reason: "limpia", consensusTarget: null, promptVersion: "v1-test" });
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
  it("presupuesto por corrida: sin presupuesto no llama al modelo (lo viejo o pendiente); lo cacheado no descuenta", async () => {
    const store = new MemoryStore();
    const v = verifier([result("apto", "a"), result("apto", "b")]);
    const budget = { left: 1 };
    expect((await verifyFor({ store, verifier: v }, "A", { today: "2026-09-10", name: null, budget }))?.reason).toBe("a");
    expect(budget.left).toBe(0);
    expect(await verifyFor({ store, verifier: v }, "B", { today: "2026-09-10", name: null, budget })).toBeNull();
    expect((await verifyFor({ store, verifier: v }, "A", { today: "2026-09-11", name: null, budget }))?.reason).toBe("a"); // caché: no descuenta ni llama
    expect(v.calls).toEqual(["A"]);
    await store.saveVerification({ symbol: "B", date: "2026-08-01", verdict: "con_reservas", reason: "vieja", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "", promptVersion: "v1-test", model: null, detectedAt: "2026-08-01T00:00:00Z" });
    expect((await verifyFor({ store, verifier: v }, "B", { today: "2026-09-10", name: null, budget }))?.reason).toBe("vieja");
  });
  it("si el modelo falla: deja lo que había (aunque esté vencido) o null si nunca hubo", async () => {
    const store = new MemoryStore();
    const logs: string[] = [];
    const v = verifier([new Error("cuota")]);
    expect(await verifyFor({ store, verifier: v, log: (m) => logs.push(m) }, "B", { today: "2026-09-10", name: null })).toBeNull();
    expect(logs[0]).toContain("falló");
    await store.saveVerification({ symbol: "B", date: "2026-08-01", verdict: "apto", reason: "vieja", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "", promptVersion: "v1-test", model: null, detectedAt: "2026-08-01T00:00:00Z" });
    const v2 = verifier([new Error("cuota")]);
    // Vencida pero con su versión: el plan decide si ese cuestionario todavía vale.
    expect(await verifyFor({ store, verifier: v2 }, "B", { today: "2026-09-10", name: null })).toEqual({ date: "2026-08-01", verdict: "apto", reason: "vieja", consensusTarget: null, promptVersion: "v1-test" });
  });
});

describe("verifyFor: volver a estructurar sin volver a buscar (18/9)", () => {
  /*
   * El 18/9 cambió el estructurador (la reserva por valuación pasó a decidirla el código) y con él la versión. Las 17
   * verificaciones vigentes quedaban "con cuestionario anterior" y había que buscarlas de nuevo con menos de 10
   * búsquedas por clave y por día. El informe está guardado y lo que se le pregunta a la web no cambió: se
   * re-estructura ese texto, sin gastar presupuesto de búsqueda, y la fila conserva la fecha de la búsqueda.
   */
  function reestructurador(results: Array<VerifierResult | Error>, compatibles: string[]) {
    const v = verifier([result("evitar", "no debería buscar")], "v2-nuevo");
    const textos: string[] = [];
    return Object.assign(v, {
      textos,
      puedeReestructurar: (version: string, texto?: string) => compatibles.includes(version) && texto !== "cortado",
      async reestructurar(i: { symbol: string; today: string; researchText: string; sources: Array<{ title: string; url: string }>; model: string | null }) {
        textos.push(`${i.symbol}|${i.today}|${i.researchText}`);
        const r = results.shift();
        if (!r) throw new Error("sin más resultados");
        if (r instanceof Error) throw r;
        return { ...r, researchText: i.researchText, sources: i.sources, model: i.model };
      },
    });
  }
  const guardarVieja = async (store: MemoryStore, date: string) => {
    await verifyFor({ store, verifier: verifier([result("con_reservas", "tercio superior")], "v1-viejo") }, "APH", { today: date, name: null });
  };

  it("APH: fila de la versión anterior, fresca y con informe: re-estructura, no busca, no gasta presupuesto y conserva la fecha", async () => {
    const store = new MemoryStore();
    await guardarVieja(store, "2026-09-15");
    const v = reestructurador([result("apto", "la única reserva era la valuación")], ["v1-viejo"]);
    const budget = { left: 1 };
    const r = await verifyFor({ store, verifier: v }, "APH", { today: "2026-09-18", name: null, budget });
    expect(r).toEqual({ date: "2026-09-15", verdict: "apto", reason: "la única reserva era la valuación", consensusTarget: null, promptVersion: "v2-nuevo" });
    expect(v.calls).toEqual([]);
    expect(v.textos).toEqual(["APH|2026-09-15|informe"]);
    expect(budget.left).toBe(1);
    expect(await store.verification("APH")).toMatchObject({ date: "2026-09-15", promptVersion: "v2-nuevo", verdict: "apto", researchText: "informe" });
    // Ya quedó con la versión vigente: la próxima vuelta la reusa sin llamar a nadie.
    await verifyFor({ store, verifier: v }, "APH", { today: "2026-09-19", name: null });
    expect(v.textos).toHaveLength(1);
  });
  it("sin presupuesto de búsqueda igual re-estructura: no es una búsqueda", async () => {
    const store = new MemoryStore();
    await guardarVieja(store, "2026-09-17");
    const v = reestructurador([result("apto")], ["v1-viejo"]);
    expect((await verifyFor({ store, verifier: v }, "APH", { today: "2026-09-18", name: null, budget: { left: 0 } }))?.verdict).toBe("apto");
  });
  it("vencida, o de una versión que no comparte el cuestionario: busca como siempre", async () => {
    const vencida = new MemoryStore();
    await guardarVieja(vencida, "2026-09-10");
    const a = reestructurador([result("apto")], ["v1-viejo"]);
    expect((await verifyFor({ store: vencida, verifier: a }, "APH", { today: "2026-09-18", name: null }))?.verdict).toBe("evitar");
    expect(a.textos).toEqual([]);
    const otra = new MemoryStore();
    await guardarVieja(otra, "2026-09-17");
    const b = reestructurador([result("apto")], ["v1-otra"]);
    expect((await verifyFor({ store: otra, verifier: b }, "APH", { today: "2026-09-18", name: null }))?.verdict).toBe("evitar");
    expect(b.textos).toEqual([]);
  });
  it("un informe guardado que no se puede re-estructurar (cortado) no se reintenta en vano: se busca de nuevo", async () => {
    const store = new MemoryStore();
    await verifyFor({ store, verifier: verifier([{ ...result("con_reservas", "tercio superior"), researchText: "cortado" }], "v1-viejo") }, "APH", { today: "2026-09-17", name: null });
    const v = reestructurador([result("apto")], ["v1-viejo"]);
    const r = await verifyFor({ store, verifier: v }, "APH", { today: "2026-09-18", name: null });
    expect(v.textos).toEqual([]);
    expect(v.calls).toEqual(["APH"]);
    expect(r).toMatchObject({ verdict: "evitar", promptVersion: "v2-nuevo", date: "2026-09-18" });
  });
  it("si el estructurador falla, queda lo que había (con su versión) y no se gasta una búsqueda: se reintenta en la próxima vuelta", async () => {
    const store = new MemoryStore();
    await guardarVieja(store, "2026-09-17");
    const v = reestructurador([new Error("503 saturado")], ["v1-viejo"]);
    const budget = { left: 3 };
    const r = await verifyFor({ store, verifier: v }, "APH", { today: "2026-09-18", name: null, budget });
    expect(r).toMatchObject({ verdict: "con_reservas", promptVersion: "v1-viejo", date: "2026-09-17" });
    expect(v.calls).toEqual([]);
    expect(budget.left).toBe(3);
  });
});
