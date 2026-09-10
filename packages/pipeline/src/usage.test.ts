import { describe, expect, it } from "vitest";
import { MemoryStore } from "./store.js";
import { StoreUsageRecorder, currentUsage, withUsageStep } from "./usage.js";

const call = { source: "finnhub" as const, endpoint: "finnhub.io/api/v1/quote", result: "ok" as const, ms: 5, status: 200 };

describe("StoreUsageRecorder", () => {
  it("record es sincrónico, toma el paso del contexto y escribe por lote", async () => {
    const store = new MemoryStore();
    const rec = new StoreUsageRecorder(store, { flushMs: 5 });
    const id = withUsageStep({ step: "radar", symbol: "NVDA" }, () => rec.record(call));
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(rec.queued).toBe(1);
    expect(store.calls).toHaveLength(0);
    await rec.flush();
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({ id, step: "radar", symbol: "NVDA", source: "finnhub", result: "ok", purpose: null, model: null });
    expect(store.calls[0]!.at).toMatch(/T/);
  });
  it("sin contexto el paso es api; el símbolo explícito le gana al del contexto", async () => {
    const store = new MemoryStore();
    const rec = new StoreUsageRecorder(store);
    rec.record(call);
    withUsageStep({ step: "cartera", symbol: "GGAL" }, () => rec.record({ ...call, symbol: "YPF", purpose: "narrador" }));
    await rec.flush();
    expect(store.calls.map((c) => [c.step, c.symbol, c.purpose])).toEqual([["api", null, null], ["cartera", "YPF", "narrador"]]);
  });
  it("setResult antes del volcado corrige en memoria; después, en el store", async () => {
    const store = new MemoryStore();
    const rec = new StoreUsageRecorder(store);
    const a = rec.record({ ...call, source: "gemini", endpoint: "gemini-2.5-flash", model: "gemini-2.5-flash", keyIndex: 1 });
    rec.setResult(a, "validacion");
    await rec.flush();
    expect(store.calls[0]!.result).toBe("validacion");
    rec.setResult(a, "error");
    await new Promise((r) => setTimeout(r, 0));
    expect(store.calls[0]!.result).toBe("error");
  });
  it("vuelca solo al llegar al tope de cola", async () => {
    const store = new MemoryStore();
    const rec = new StoreUsageRecorder(store, { maxQueue: 3, flushMs: 60_000 });
    rec.record(call);
    rec.record(call);
    expect(store.calls).toHaveLength(0);
    rec.record(call);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.calls).toHaveLength(3);
    expect(rec.queued).toBe(0);
  });
  it("un store que falla no rompe al que registra", async () => {
    const logs: string[] = [];
    const rec = new StoreUsageRecorder({ insertCalls: async () => { throw new Error("db caída"); }, setCallResult: async () => {} }, { log: (m) => logs.push(m) });
    rec.record(call);
    await rec.flush();
    expect(logs[0]).toContain("db caída");
    expect(rec.queued).toBe(0);
  });
  it("el contexto se anida y se propaga a través de awaits", async () => {
    const seen: Array<string | undefined> = [];
    await withUsageStep({ step: "api" }, async () => {
      seen.push(currentUsage()?.step);
      await withUsageStep({ step: "tesis" }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(currentUsage()?.step);
      });
      seen.push(currentUsage()?.step);
    });
    expect(seen).toEqual(["api", "tesis", "api"]);
    expect(currentUsage()).toBeUndefined();
  });
});
