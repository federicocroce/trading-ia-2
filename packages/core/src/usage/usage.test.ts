import { describe, expect, it } from "vitest";
import { KeyedRateLimiter, RateLimiter, dailyUsage, estimateCostUsd, recordingFetch, resultForStatus, sourceForHost, summarizeUsage, type UsageCall, type UsageCallInput, type UsageRecorder, type UsageResult } from "./index.js";

function memRecorder() {
  const rows: Array<UsageCallInput & { id: string }> = [];
  const rec: UsageRecorder & { rows: typeof rows } = {
    rows,
    record(call) {
      const id = `id${rows.length + 1}`;
      rows.push({ ...call, id });
      return id;
    },
    setResult(id, result: UsageResult) {
      const r = rows.find((x) => x.id === id);
      if (r) r.result = result;
    },
  };
  return rec;
}

describe("sourceForHost y precios", () => {
  it("mapea hosts conocidos y deja el resto en otro", () => {
    expect(sourceForHost("finnhub.io")).toBe("finnhub");
    expect(sourceForHost("data.alpaca.markets")).toBe("alpaca");
    expect(sourceForHost("paper-api.alpaca.markets")).toBe("alpaca");
    expect(sourceForHost("data.sec.gov")).toBe("sec");
    expect(sourceForHost("query2.finance.yahoo.com")).toBe("yahoo");
    expect(sourceForHost("generativelanguage.googleapis.com")).toBe("gemini");
    expect(sourceForHost("dolarapi.com")).toBe("otro");
  });
  it("costo equivalente: entrada al precio de entrada, salida y pensamiento al de salida", () => {
    // 1M in a 0.30 + (0.5M out + 0.5M think) a 2.50 = 0.30 + 2.50
    expect(estimateCostUsd("gemini-2.5-flash", 1_000_000, 500_000, 500_000)).toBeCloseTo(2.8, 6);
    expect(estimateCostUsd("gemini-3.8-flash", 1_000_000, 0, 0)).toBeCloseTo(0.75, 6);
    expect(estimateCostUsd("desconocido", 1_000_000, 0, 0)).toBe(0);
    expect(estimateCostUsd(null, 1_000_000, 0, 0)).toBe(0);
  });
});

describe("recordingFetch", () => {
  const okResponse = (status = 200) => ({ status, ok: status >= 200 && status < 300 }) as Response;
  it("registra fuente por host, path sin query, símbolo, estado y tiempo", async () => {
    const rec = memRecorder();
    let t = 1000;
    const f = recordingFetch(rec, async () => { t += 120; return okResponse(); }, { now: () => t });
    const res = await f("https://finnhub.io/api/v1/stock/metric?symbol=nvda&token=SECRETO");
    expect(res.status).toBe(200);
    expect(rec.rows).toHaveLength(1);
    const r = rec.rows[0]!;
    expect(r.source).toBe("finnhub");
    expect(r.endpoint).toBe("finnhub.io/api/v1/stock/metric");
    expect(r.endpoint).not.toContain("SECRETO");
    expect(r.symbol).toBe("NVDA");
    expect(r.status).toBe(200);
    expect(r.result).toBe("ok");
    expect(r.ms).toBe(120);
  });
  it("429 en fuente de datos es rpm, 503 saturado, 404 error; el error de red se registra y se relanza", async () => {
    const rec = memRecorder();
    const f = recordingFetch(rec, async (input) => {
      const u = String(input);
      if (u.includes("boom")) throw new Error("fetch failed");
      return okResponse(u.includes("429") ? 429 : u.includes("503") ? 503 : 404);
    });
    await f("https://data.alpaca.markets/v2/429");
    await f("https://data.sec.gov/api/503");
    await f("https://query2.finance.yahoo.com/v8/404");
    await expect(f("https://dolarapi.com/boom")).rejects.toThrow("fetch failed");
    expect(rec.rows.map((r) => r.result)).toEqual(["rpm", "saturado", "error", "error"]);
    expect(rec.rows.map((r) => r.source)).toEqual(["alpaca", "sec", "yahoo", "otro"]);
    expect(rec.rows[3]!.status).toBeNull();
    expect(resultForStatus(201)).toBe("ok");
  });
  it("saltea los hosts que registran por su cuenta (Gemini) y acepta Request y URL", async () => {
    const rec = memRecorder();
    const f = recordingFetch(rec, async () => okResponse());
    await f("https://generativelanguage.googleapis.com/v1beta/models/x:generateContent");
    await f(new URL("https://finnhub.io/api/v1/quote?symbol=aapl"));
    await f(new Request("https://finnhub.io/api/v1/news"));
    expect(rec.rows.map((r) => r.endpoint)).toEqual(["finnhub.io/api/v1/quote", "finnhub.io/api/v1/news"]);
  });
});

describe("RateLimiter", () => {
  it("deja pasar N por minuto y después espera hasta que venza la más vieja", async () => {
    let now = 0;
    const waits: number[] = [];
    const l = new RateLimiter(2, () => now, async (ms) => { waits.push(ms); now += ms; });
    await l.acquire();
    await l.acquire();
    await l.acquire();
    expect(waits).toEqual([60_001]);
    expect(now).toBe(60_001);
  });
  it("KeyedRateLimiter separa por clave", async () => {
    let now = 0;
    const waits: number[] = [];
    const l = new KeyedRateLimiter(1, () => now, async (ms) => { waits.push(ms); now += ms; });
    await l.acquire("a");
    await l.acquire("b");
    expect(waits).toEqual([]);
    await l.acquire("a");
    expect(waits).toEqual([60_001]);
  });
});

describe("summarizeUsage", () => {
  const call = (o: Partial<UsageCall>): UsageCall => ({ id: "x", at: "2026-09-10T12:00:00.000Z", source: "finnhub", step: "radar", purpose: null, symbol: null, endpoint: "e", model: null, keyIndex: null, status: 200, result: "ok", tokensIn: null, tokensOut: null, tokensThink: null, ms: 10, ...o });
  it("Gemini: el pico por minuto se cuenta por modelo y clave, no sumando las cuatro claves", () => {
    // El 11/9 la pantalla mostraba "12 llamadas en un minuto, 120% del límite" en rojo. El freno real es por
    // modelo y clave (KeyedRateLimiter usa `modelo#clave`), y el máximo real de ese minuto era 6.
    const mismoMinuto = (model: string, keyIndex: number, n: number) =>
      Array.from({ length: n }, (_, i) => call({ source: "gemini", model, keyIndex, at: `2026-09-10T12:00:${String(i).padStart(2, "0")}.000Z` }));
    const calls = [...mismoMinuto("gemini-2.5-flash", 1, 6), ...mismoMinuto("gemini-2.5-flash", 2, 6)];
    const g = summarizeUsage(calls, { date: "2026-09-10" }).bySource.find((r) => r.source === "gemini")!;
    expect(g.calls).toBe(12);
    expect(g.peakPerMinute).toBe(6);
    expect(g.pctMinute).toBeLessThan(100);
  });

  it("cuenta por fuente con pico por minuto y % contra límites; sin límite da null", () => {
    const calls = [
      ...Array.from({ length: 50 }, (_, i) => call({ at: `2026-09-10T12:00:${String(i).padStart(2, "0")}.000Z` })),
      call({ at: "2026-09-10T12:01:00.000Z", result: "rpm", status: 429 }),
      call({ source: "yahoo", step: "precios" }),
    ];
    const s = summarizeUsage(calls, { date: "2026-09-10" });
    const fh = s.bySource.find((r) => r.source === "finnhub")!;
    expect(fh.calls).toBe(51);
    expect(fh.errors).toBe(1);
    expect(fh.peakPerMinute).toBe(50);
    expect(fh.pctMinute).toBeCloseTo(83.33, 1);
    expect(fh.pctDay).toBeNull();
    expect(s.bySource.find((r) => r.source === "yahoo")!.pctMinute).toBeNull();
    expect(s.warnings.some((w) => w.startsWith("finnhub: pico de 50"))).toBe(true);
    expect(s.total).toEqual({ calls: 52, errors: 1, costUsd: 0 });
    expect(s.byStep.map((r) => [r.step, r.source, r.calls])).toEqual([["radar", "finnhub", 51], ["precios", "yahoo", 1]]);
  });
  it("Gemini por modelo y clave: resultados, tokens, costo y % del día; aviso si falla demasiado", () => {
    const g = (o: Partial<UsageCall>) => call({ source: "gemini", model: "gemini-2.5-flash", keyIndex: 1, endpoint: "gemini-2.5-flash", purpose: "ficha", tokensIn: 10_000, tokensOut: 100, tokensThink: 900, ...o });
    const calls = [g({}), g({}), g({ result: "rpm", status: 429, tokensIn: null, tokensOut: null, tokensThink: null }), g({ keyIndex: 2, model: "gemini-3.6-flash", endpoint: "gemini-3.6-flash" }), g({ result: "validacion" }), g({ result: "saturado", status: 503, tokensIn: null, tokensOut: null, tokensThink: null })];
    const s = summarizeUsage(calls, { date: "2026-09-10" });
    expect(s.gemini.rows.map((r) => `${r.model}#${r.keyIndex}`)).toEqual(["gemini-2.5-flash#1", "gemini-3.6-flash#2"]);
    const k1 = s.gemini.rows[0]!;
    expect(k1.calls).toBe(5);
    expect(k1.ok).toBe(2);
    expect(k1.rpm).toBe(1);
    expect(k1.validacion).toBe(1);
    expect(k1.saturado).toBe(1);
    expect(k1.tokensIn).toBe(30_000);
    expect(k1.pctDay).toBeNull(); // Google no publica la cuota diaria real: sin evidencia no hay %
    const exhausted = summarizeUsage([g({}), g({ result: "rpd", status: 429, tokensIn: null, tokensOut: null, tokensThink: null })], { date: "2026-09-10" });
    expect(exhausted.gemini.rows[0]!.pctDay).toBe(100);
    expect(exhausted.warnings.some((w) => w.includes("cuota diaria agotada"))).toBe(true);
    // 30k in * 0.30 + 3k out * 2.50 = 0.009 + 0.0075
    expect(k1.costUsd).toBeCloseTo(0.0165, 3);
    expect(s.gemini.failedPct).toBe(50);
    expect(s.warnings.some((w) => w.startsWith("gemini: falló el 50%"))).toBe(true);
    // La fila por fuente de Gemini no compara contra el día (la cuota es por modelo y clave).
    expect(s.bySource.find((r) => r.source === "gemini")!.pctDay).toBeNull();
    expect(s.total.costUsd).toBeGreaterThan(0);
  });
  it("sin llamadas: todo en cero y sin avisos", () => {
    const s = summarizeUsage([], { date: "2026-09-10" });
    expect(s.total.calls).toBe(0);
    expect(s.gemini.failedPct).toBeNull();
    expect(s.warnings).toEqual([]);
  });
  it("dailyUsage: un punto por día pedido (ceros incluidos), por fuente, con el día local que le pasan", () => {
    const calls = [
      call({ at: "2026-09-09T23:30:00.000Z" }), // en Buenos Aires es el 9 a las 20:30
      call({ at: "2026-09-10T01:00:00.000Z", source: "gemini", model: "gemini-2.5-flash", tokensIn: 1_000_000, tokensOut: 0, tokensThink: 0 }), // 9 a las 22:00
      call({ at: "2026-09-10T15:00:00.000Z", source: "gemini", model: "gemini-2.5-flash", result: "rpm", status: 429 }),
    ];
    const ba = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
    const s = dailyUsage(calls, ["2026-09-08", "2026-09-09", "2026-09-10"], ba);
    expect(s.map((d) => [d.date, d.calls, d.errors])).toEqual([["2026-09-08", 0, 0], ["2026-09-09", 2, 0], ["2026-09-10", 1, 1]]);
    expect(s[1]!.bySource).toEqual({ finnhub: 1, gemini: 1 });
    expect(s[1]!.costUsd).toBeCloseTo(0.3, 3);
    expect(s[2]!).toMatchObject({ geminiCalls: 1, geminiFailed: 1, bySource: { gemini: 1 } });
  });
});
