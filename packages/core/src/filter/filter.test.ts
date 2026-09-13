import { describe, expect, it } from "vitest";
import { DefaultFilter, daysBetween } from "./index.js";
import type { RawEvent } from "../schemas/event.js";

const ev = (over: Partial<RawEvent>): RawEvent => ({
  id: crypto.randomUUID(),
  ticker: "AAA",
  eventType: "earnings",
  source: "earnings_calendar",
  eventDate: "2026-09-20",
  sourceRef: "x",
  title: "t",
  payload: {},
  observedAt: "2026-09-04T00:00:00.000Z",
  ...over,
});

const quotes = async (t: string) =>
  t === "ILLIQ" ? { ticker: t, price: 5, asOf: "", avgVolume30d: 1000 } : t === "NOQ" ? null : { ticker: t, price: 20, asOf: "", avgVolume30d: 1_000_000 };

const ctx = { today: "2026-09-04", maxCandidates: 2 };

describe("DefaultFilter", () => {
  it("dedupe por clave", async () => {
    const r = await new DefaultFilter(quotes).apply([ev({}), ev({})], ctx);
    expect(r.passed).toHaveLength(1);
    expect(r.dropped[0]?.reason).toBe("duplicate");
  });
  it("ventana de días", async () => {
    const r = await new DefaultFilter(quotes).apply([ev({ eventDate: "2026-09-06" }), ev({ eventDate: "2026-12-01" })], ctx);
    expect(r.passed).toHaveLength(0);
    expect(r.dropped.map((d) => d.reason)).toEqual([expect.stringContaining("< min"), expect.stringContaining("> max")]);
  });
  it("liquidez y precio", async () => {
    const r = await new DefaultFilter(quotes).apply([ev({ ticker: "ILLIQ" }), ev({ ticker: "NOQ" })], ctx);
    expect(r.passed).toHaveLength(0);
  });
  it("allowlist como función (ADRs de posiciones y seguimiento que cambian solos)", async () => {
    const f = new DefaultFilter(quotes, { ...(await import("./index.js")).DEFAULT_FILTER_CONFIG, allowlist: async () => ["ILLIQ"] });
    const r = await f.apply([ev({ ticker: "ILLIQ" })], ctx);
    expect(r.passed.map((e) => e.ticker)).toEqual(["ILLIQ"]);
  });
  it("allowlist saltea liquidez", async () => {
    const f = new DefaultFilter(quotes, { ...(await import("./index.js")).DEFAULT_FILTER_CONFIG, allowlist: ["ILLIQ"] });
    const r = await f.apply([ev({ ticker: "ILLIQ" })], ctx);
    expect(r.passed).toHaveLength(1);
  });
  it("presupuesto con prioridad por tipo", async () => {
    const r = await new DefaultFilter(quotes).apply(
      [ev({ eventType: "operational", eventDate: null, sourceRef: "a" }), ev({ eventType: "fda", sourceRef: "b" }), ev({ sourceRef: "c" })],
      ctx,
    );
    expect(r.passed.map((e) => e.eventType)).toEqual(["fda", "earnings"]);
    expect(r.dropped[0]?.reason).toBe("budget exceeded");
  });
});

describe("daysBetween", () => {
  it("cuenta días calendario", () => expect(daysBetween("2026-09-04", "2026-09-20")).toBe(16));
});

describe("DefaultFilter: tope de Form 4 por ticker", () => {
  const f4 = (ticker: string, ref: string, buy: number) =>
    ev({ ticker, eventType: "operational", eventDate: null, source: "edgar", sourceRef: ref, payload: { form: "4", insider: "compra", insiderBuyShares: buy } });
  const k8 = (ticker: string, ref: string) => ev({ ticker, eventType: "operational", eventDate: null, source: "edgar", sourceRef: ref, payload: { form: "8-K" } });
  const wide = { today: "2026-09-04", maxCandidates: 10 };

  it("queda un solo Form 4 por ticker por corrida, el de la compra más grande; el resto se descarta con razón form4 cap", async () => {
    const r = await new DefaultFilter(quotes).apply([f4("AAA", "a", 56), f4("AAA", "b", 5000), f4("AAA", "c", 100), k8("AAA", "d")], wide);
    expect(r.passed.map((e) => e.sourceRef).sort()).toEqual(["b", "d"]);
    expect(r.dropped.map((d) => [d.event.sourceRef, d.reason])).toEqual([["a", "form4 cap"], ["c", "form4 cap"]]);
  });
  it("el tope es por ticker: un Form 4 de otro ticker no se descarta", async () => {
    const r = await new DefaultFilter(quotes).apply([f4("AAA", "a", 56), f4("BBB", "b", 10)], wide);
    expect(r.passed.map((e) => e.ticker).sort()).toEqual(["AAA", "BBB"]);
    expect(r.dropped).toEqual([]);
  });
});

/**
 * TSM el 9/9/2026: treinta ejecutivos presentaron Form 4 de compra el mismo día, cada uno entre 32 y 149
 * acciones. Es el plan de compensación de la empresa, no la convicción de nadie. El tope de una Form 4 por
 * corrida igual dejaba pasar la más grande al modelo, y la más grande de un plan sigue siendo un plan.
 * Antes de ese tope, 98 Form 4 de TSM llegaron a Gemini y ninguna produjo una propuesta.
 */
describe("DefaultFilter: compras programadas", () => {
  const compra = (ticker: string, ref: string, quien: string, dia: string, acciones = 50) =>
    ev({ ticker, eventType: "operational", eventDate: null, source: "edgar", sourceRef: ref, payload: { form: "4", insider: "compra", insiderOwner: quien, insiderBuyShares: acciones, filingDate: dia } });
  const wide = { today: "2026-09-10", maxCandidates: 50 };

  it("cinco o más insiders comprando el mismo día es un plan: se descartan TODAS, también la más grande", async () => {
    const tsm = ["Lee", "Tien", "Wei", "Zhang", "Lin", "Wu"].map((q, i) => compra("TSM", `t${i}`, q, "2026-09-09", 40 + i * 20));
    const r = await new DefaultFilter(quotes).apply(tsm, wide);
    expect(r.passed).toEqual([]);
    expect(r.dropped).toHaveLength(6);
    expect(r.dropped.every((d) => d.reason.startsWith("compra programada: 6 insiders"))).toBe(true);
  });

  it("una compra suelta sigue siendo señal y pasa", async () => {
    const r = await new DefaultFilter(quotes).apply([compra("NBN", "n1", "Director", "2026-09-09", 20_000)], wide);
    expect(r.passed.map((e) => e.sourceRef)).toEqual(["n1"]);
  });

  it("cuatro insiders no alcanzan: por debajo del umbral decide el tope de siempre", async () => {
    const r = await new DefaultFilter(quotes).apply(["A", "B", "C", "D"].map((q, i) => compra("GLW", `g${i}`, q, "2026-09-09", 10 + i)), wide);
    expect(r.passed).toHaveLength(1);
    expect(r.dropped.every((d) => d.reason === "form4 cap")).toBe(true);
  });

  it("el mismo insider presentando cinco veces no es un plan: cuenta insiders distintos, no presentaciones", async () => {
    const r = await new DefaultFilter(quotes).apply([1, 2, 3, 4, 5].map((i) => compra("APH", `a${i}`, "El mismo", "2026-09-09", i * 100)), wide);
    expect(r.passed).toHaveLength(1);
    expect(r.dropped.some((d) => d.reason.startsWith("compra programada"))).toBe(false);
  });

  it("una Form 4 de rutina (vesting, impuestos) se descarta con su motivo y nunca llega al modelo", async () => {
    const rutina = ev({ ticker: "NVDA", eventType: "operational", eventDate: null, source: "edgar", sourceRef: "r1", payload: { form: "4", insider: "rutina", insiderCodes: ["M", "F"] } });
    const r = await new DefaultFilter(quotes).apply([rutina], wide);
    expect(r.passed).toEqual([]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["form4 rutina"]);
  });

  it("días distintos no se juntan: cada fecha se cuenta aparte", async () => {
    const r = await new DefaultFilter(quotes).apply(["A", "B", "C", "D", "E"].map((q, i) => compra("MU", `m${i}`, q, `2026-09-0${i + 1}`)), wide);
    expect(r.dropped.some((d) => d.reason.startsWith("compra programada"))).toBe(false);
  });
});

