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
