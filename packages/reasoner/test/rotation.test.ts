import { describe, expect, it } from "vitest";
import { MUERTO_MS, QuotaTracker, attemptOrder, classifyError, dailyResetAt, withRotation } from "../src/gemini/rotation.js";

describe("attemptOrder", () => {
  it("recorre modelo-mayor, key-menor (la cuota free es por modelo)", () => {
    expect(attemptOrder(["A", "B"], 2)).toEqual([
      { model: "A", keyIndex: 0 },
      { model: "A", keyIndex: 1 },
      { model: "B", keyIndex: 0 },
      { model: "B", keyIndex: 1 },
    ]);
  });
});

describe("classifyError", () => {
  it("429 con cuota es quota", () => expect(classifyError("HTTP 429 RESOURCE_EXHAUSTED: quota exceeded")).toBe("quota"));
  it("'limit: 0' viaja como 429 pero es modelo muerto (no está en el plan)", () => expect(classifyError("HTTP 429 quota ... limit: 0")).toBe("muerto"));
  it("'no longer available' es muerto", () => expect(classifyError("HTTP 404 This model is no longer available to new users")).toBe("muerto"));
  it("503 alta demanda es retryable", () => expect(classifyError("HTTP 503 UNAVAILABLE: high demand")).toBe("retryable"));
  it("red caída es retryable", () => expect(classifyError("fetch failed")).toBe("retryable"));
  it("400 es otro (no se marca nada)", () => expect(classifyError("HTTP 400 INVALID_ARGUMENT")).toBe("otro"));
});

describe("QuotaTracker", () => {
  it("marca y expira según el reloj inyectado", () => {
    let now = 1_000_000;
    const t = new QuotaTracker(() => now);
    expect(t.isExhausted("m", 0)).toBe(false);
    t.markExhausted("m", 0, new Date(now + 60_000));
    expect(t.isExhausted("m", 0)).toBe(true);
    expect(t.isExhausted("m", 1)).toBe(false);
    now += 60_001;
    expect(t.isExhausted("m", 0)).toBe(false);
  });
});

describe("dailyResetAt", () => {
  it("es el próximo 00:05 hora Pacífico, dentro de las 24h", () => {
    const now = new Date("2026-09-05T18:00:00Z");
    const reset = dailyResetAt(now);
    expect(reset.getTime()).toBeGreaterThan(now.getTime());
    expect(reset.getTime() - now.getTime()).toBeLessThanOrEqual(24 * 3600_000 + 5 * 60_000);
    const hhmm = reset.toLocaleTimeString("en-GB", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit" });
    expect(hhmm).toBe("00:05");
  });
  it("cae exacto en el minuto, sin arrastrar segundos ni milisegundos del reloj", () => {
    const reset = dailyResetAt(new Date("2026-09-05T18:00:37.345Z"));
    expect(reset.getUTCSeconds()).toBe(0);
    expect(reset.getUTCMilliseconds()).toBe(0);
  });
});

describe("withRotation", () => {
  const keys = ["k0", "k1"];
  const models = ["A", "B"];

  it("devuelve el primer intento que funciona", async () => {
    const calls: string[] = [];
    const r = await withRotation({ models, keys, tracker: new QuotaTracker(), attempt: async (m, k) => { calls.push(`${m}:${k}`); return "ok"; } });
    expect(r.result).toBe("ok");
    expect(r.model).toBe("A");
    expect(calls).toEqual(["A:k0"]);
  });

  it("503 pasa a la siguiente key sin marcar nada", async () => {
    const calls: string[] = [];
    const tracker = new QuotaTracker();
    const r = await withRotation({ models, keys, tracker, attempt: async (m, k) => { calls.push(`${m}:${k}`); if (k === "k0") throw new Error("HTTP 503 high demand"); return "ok"; } });
    expect(r.result).toBe("ok");
    expect(calls).toEqual(["A:k0", "A:k1"]);
    expect(tracker.isExhausted("A", 0)).toBe(false);
  });

  it("429 de cuota marca modelo+key hasta el reset diario y la próxima vez la saltea", async () => {
    let now = new Date("2026-09-05T18:00:00Z").getTime();
    const tracker = new QuotaTracker(() => now);
    const calls: string[] = [];
    const attempt = async (m: string, k: string) => { calls.push(`${m}:${k}`); if (k === "k0") throw new Error("HTTP 429 RESOURCE_EXHAUSTED quota"); return "ok"; };
    const clock = () => now;
    await withRotation({ models, keys, tracker, attempt, now: clock });
    expect(tracker.isExhausted("A", 0)).toBe(true);
    calls.length = 0;
    await withRotation({ models, keys, tracker, attempt, now: clock });
    expect(calls).toEqual(["A:k1"]);
    now = dailyResetAt(new Date(now)).getTime() + 1;
    expect(tracker.isExhausted("A", 0)).toBe(false);
  });

  it("'limit: 0' marca el modelo muerto por una semana", async () => {
    const now = Date.now();
    const tracker = new QuotaTracker(() => now);
    await withRotation({ models, keys, tracker, now: () => now, attempt: async (m, k) => { if (m === "A" && k === "k0") throw new Error("HTTP 429 quota limit: 0"); return "ok"; } });
    expect(tracker.isExhausted("A", 0)).toBe(true);
    expect(tracker.resetAt("A", 0)).toBe(now + MUERTO_MS);
  });

  it("si todos fallan, lanza el último error", async () => {
    await expect(withRotation({ models, keys, tracker: new QuotaTracker(), attempt: async (m, k) => { throw new Error(`falló ${m}:${k}`); } })).rejects.toThrow("falló B:k1");
  });

  it("si todos están agotados, lanza sin intentar", async () => {
    const tracker = new QuotaTracker();
    for (const m of models) for (let i = 0; i < keys.length; i++) tracker.markExhausted(m, i, new Date(Date.now() + 60_000));
    let called = 0;
    await expect(withRotation({ models, keys, tracker, attempt: async () => { called++; return "ok"; } })).rejects.toThrow(/agotad/);
    expect(called).toBe(0);
  });
});
