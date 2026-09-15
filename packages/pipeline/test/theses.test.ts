import { describe, expect, it } from "vitest";
import { DefaultRiskEngine, type RawEvent, type Reasoner, type Thesis } from "@thesis/core";
import { MemoryStore, approveAndExecute, buildSnapshot, dailyRun, retirarReemplazadas, tesisReemplazadas } from "../src/index.js";

const VIST = "cb3536a7-112c-4ee5-b520-7da6f7784e6b";
const PAM = "c3272f24-68d3-4e12-9361-0a4373c95c49";
const TSM = "35745474-a1a1-4bb1-8ea6-705b30e97906";
const NEM = "567e310c-ff81-4786-97cc-baa4e9a16c34";

let n = 0;
const tesis = (rawEventId: string, ticker: string, createdAt: string, o: Partial<Thesis> = {}): Thesis => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, rawEventId, ticker, eventType: "operational", eventDate: null, direction: "long", pEstimate: 0.65, pMarket: 0.5, edge: 0.15,
  instrument: "stock", entryMax: 80, target: 88, invalidation: "Si el precio cierra por debajo del mínimo de la semana.", confidence: "med",
  reasoning: "Razonamiento de prueba suficientemente largo para pasar la validación mínima de caracteres.", sources: ["s"], status: "proposed", rejectionReason: null,
  promptVersion: "v-test", createdAt, updatedAt: createdAt, ...o,
});

/**
 * Tal como estaban el 15/9. El 6-K de Vista (evento cb3536a7) tenía cinco tesis propuestas vivas, con objetivos de 82 a
 * 88, y el de Pampa (c3272f24) tres, más cuatro rechazadas. Eran copias del mismo filing que la migración 0020 volvió a
 * apuntar al evento original; cada una una lectura distinta de Gemini, todas en Propuestas a la vez.
 */
const vist = [
  tesis(VIST, "VIST", "2026-09-08T15:34:36.425Z", { entryMax: 75.5, target: 82.6 }),
  tesis(VIST, "VIST", "2026-09-09T13:50:45.492Z", { entryMax: 77.5, target: 85.5, edge: 0.25 }),
  tesis(VIST, "VIST", "2026-09-09T14:18:30.334Z", { entryMax: 76, target: 84 }),
  tesis(VIST, "VIST", "2026-09-09T14:36:07.517Z", { entryMax: 76.5, target: 82 }),
  tesis(VIST, "VIST", "2026-09-11T10:40:08.657Z", { entryMax: 80, target: 88 }),
];
const rechazada = { status: "rejected" as const, rejectionReason: "edge_below_threshold" as const, edge: 0.1 };
const pam = [
  tesis(PAM, "PAM", "2026-09-08T15:33:18.681Z", { entryMax: 86.5, target: 98 }),
  tesis(PAM, "PAM", "2026-09-09T13:49:35.226Z", { entryMax: 88, target: 92 }),
  tesis(PAM, "PAM", "2026-09-09T14:17:26.499Z", { entryMax: 86.5, target: 90, ...rechazada }),
  tesis(PAM, "PAM", "2026-09-09T14:32:07.566Z", { entryMax: 86.5, target: 96 }),
  tesis(PAM, "PAM", "2026-09-10T10:37:26.776Z", { entryMax: 87, target: 92, ...rechazada }),
  tesis(PAM, "PAM", "2026-09-10T10:43:47.308Z", { entryMax: 86.5, target: 98, ...rechazada }),
  tesis(PAM, "PAM", "2026-09-11T10:38:32.485Z", { entryMax: 89, target: 95, ...rechazada }),
];
const tsm = tesis(TSM, "TSM", "2026-09-11T10:41:55.100Z");
const nemAbierta = tesis(NEM, "NEM", "2026-09-10T10:32:18.157Z", { status: "open" });

describe("tesisReemplazadas: una tesis viva por evento", () => {
  it("VIST 15/9: de las cinco propuestas del mismo 6-K queda viva la última (80 → 88); las otras cuatro, reemplazadas por ella", () => {
    const r = tesisReemplazadas([...vist, tsm]);
    expect([...r.keys()].sort()).toEqual(vist.slice(0, 4).map((t) => t.id).sort());
    for (const t of vist.slice(0, 4)) expect(r.get(t.id)!.id).toBe(vist[4]!.id);
    expect(r.has(vist[4]!.id)).toBe(false);
    expect(r.has(tsm.id)).toBe(false);
  });

  it("PAM 15/9: la última lectura del mismo 6-K dio edge 10 puntos y quedó rechazada; las tres propuestas anteriores no siguen vivas", () => {
    const r = tesisReemplazadas(pam);
    const propuestas = pam.filter((t) => t.status === "proposed");
    expect([...r.keys()].sort()).toEqual(propuestas.map((t) => t.id).sort());
    for (const t of propuestas) expect(r.get(t.id)!.id).toBe(pam[6]!.id);
  });

  it("si el evento ya tiene una tesis aprobada o abierta, una propuesta nueva no es una segunda tesis viva", () => {
    const nueva = tesis(NEM, "NEM", "2026-09-12T10:00:00.000Z");
    const r = tesisReemplazadas([nemAbierta, nueva]);
    expect(r.get(nueva.id)!.id).toBe(nemAbierta.id);
    expect(r.has(nemAbierta.id)).toBe(false);
  });

  it("una reemplazada que ya se retiró (rechazada sin motivo de la base) sigue diciendo quién la reemplazó", () => {
    const retirada = { ...vist[0]!, status: "rejected" as const };
    const r = tesisReemplazadas([retirada, vist[4]!]);
    expect(r.get(retirada.id)!.id).toBe(vist[4]!.id);
  });
});

describe("retirarReemplazadas: la corrida deja una sola viva por evento", () => {
  it("VIST y PAM del 15/9: pasan a rechazadas las siete que no son la última lectura; la de TSM y la abierta de NEM no se tocan", async () => {
    const store = new MemoryStore();
    for (const t of [...vist, ...pam, tsm, nemAbierta]) store.theses.set(t.id, { ...t });
    const retiradas = await retirarReemplazadas(store);
    expect(retiradas.map((x) => x.ticker).sort()).toEqual(["PAM", "PAM", "PAM", "VIST", "VIST", "VIST", "VIST"]);
    expect((await store.thesesByStatus("proposed")).map((t) => t.ticker).sort()).toEqual(["TSM", "VIST"]);
    expect((await store.thesesByStatus("proposed")).find((t) => t.ticker === "VIST")!.target).toBe(88);
    expect(store.theses.get(nemAbierta.id)!.status).toBe("open");
    // Idempotente: una segunda pasada no encuentra nada.
    expect(await retirarReemplazadas(store)).toEqual([]);
  });

  it("dailyRun: la lectura nueva de un evento reemplaza a la propuesta anterior del mismo evento", async () => {
    const store = new MemoryStore();
    const ev: RawEvent = { id: VIST, ticker: "VIST", eventType: "operational", source: "edgar", eventDate: null, sourceRef: "6-K-vista", title: "6-K — Vista Energy, S.A.B. de C.V.", payload: {}, observedAt: "2026-09-08T12:00:00Z" };
    await store.insertRawEvents([ev]);
    const vieja = { ...vist[0]! };
    store.theses.set(vieja.id, vieja);
    const reasoner: Reasoner = { promptVersion: "v-test", propose: async (b) => ({ ticker: "VIST", eventType: "operational", eventDate: null, direction: "long", pEstimate: 0.65, pMarket: 0.5, instrument: "stock", entryMax: 80, target: 88, invalidation: "Si el precio cierra por debajo del mínimo de la semana.", confidence: "med", reasoning: `Lectura nueva del ${b.event.title}, suficientemente larga para pasar la validación.`, sources: ["s"] }) };
    const filter = { apply: async (evs: RawEvent[]) => ({ passed: evs, dropped: [] }) };
    const s = await dailyRun({ store, ingestors: [], filter: filter as never, reasoner, documents: { documentsFor: async () => [] }, marketData: { getQuote: async () => null, getImpliedMove: async () => null, findOption: async () => null } as never, minEdge: 0.1, maxCandidates: 5 }, { since: "2026-09-01", today: "2026-09-15" });
    expect(s.proposed).toHaveLength(1);
    expect(s.reemplazadas).toEqual([{ id: vieja.id, ticker: "VIST", por: s.proposed[0]!.id }]);
    expect(store.theses.get(vieja.id)!.status).toBe("rejected");
    expect((await store.thesesByStatus("proposed")).map((t) => t.id)).toEqual([s.proposed[0]!.id]);
  });
});

describe("aprobar una tesis reemplazada", () => {
  it("no se puede: la lectura vigente del evento es otra", async () => {
    const store = new MemoryStore();
    for (const t of vist) store.theses.set(t.id, { ...t });
    const account = { equity: 100_000, lastEquity: 100_000 };
    const res = await approveAndExecute(vist[0]!.id, {
      store, risk: new DefaultRiskEngine(), marketData: { getQuote: async (t: string) => ({ ticker: t, price: 76, asOf: "", avgVolume30d: 1_000_000 }), getImpliedMove: async () => null, findOption: async () => null },
      broker: { paper: true, submit: async () => { throw new Error("no debería mandar la orden"); }, getOrder: async () => { throw new Error("x"); }, cancel: async () => {} },
      snapshot: async () => buildSnapshot(store, account, false),
    });
    expect(res).toEqual({ ok: false, reason: "superseded", detail: expect.stringContaining("2026-09-11") });
    expect(store.theses.get(vist[0]!.id)!.status).toBe("proposed");
  });
});
