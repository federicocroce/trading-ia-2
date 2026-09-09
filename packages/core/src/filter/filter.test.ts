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
