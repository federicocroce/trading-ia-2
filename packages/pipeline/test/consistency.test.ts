import { describe, expect, it } from "vitest";
import { checkRun } from "../src/index.js";

/**
 * El chequeo `velas_desfasadas` necesita saber cuál fue la última rueda cerrada, y eso NO sale de lo guardado:
 * lo pone la corrida con su reloj. Sin este test el control existe en core y nunca corre en la app, que es
 * exactamente lo que pasó el 23/9/2026 con el plan armado sobre los cierres del 21.
 */
const vela = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1, adjClose: null });

const store = (ultimaVela: string, builtAt?: string) => ({
  latestCandidates: async () => [{
    symbol: "APH", candidateDate: "2026-09-23", kind: "stock" as const, verdict: "COMPRAR" as const, score: 1, axes: {}, peerGroup: [],
    rankInGroup: null, groupSize: null, close: 80.72, entryLow: 80.72, entryHigh: 82.33, stop: null, target: null, sizeUsd: null, sizeQty: null,
    riskScore: 3, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null,
    spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null,
    alpha90dPct: null, measuredAt: null, entry: null,
  }],
  latestPlan: async () => (builtAt ? { month: "2026-09", totalUsd: 40_000, notes: [], builtAt, lines: [{ symbol: "APH", kind: "comprar", amountUsd: 4_000, rationale: "por convicción", close: 80.72, stop: 73.64, alpha30dPct: null, alpha90dPct: null }] } : null),
  candles: async () => [vela("2026-09-18", 77.55), vela(ultimaVela, 80.72)],
  fundamentals: async () => null,
  newsScannedTo: async () => "2026-09-23",
  positions: async () => [],
  verification: async () => null,
});

describe("checkRun", () => {
  const miercolesDuranteLaRueda = new Date("2026-09-23T15:00:00Z");

  it("avisa cuando las velas no llegan a la última rueda cerrada", async () => {
    const r = await checkRun({ store: store("2026-09-21") } as never, { today: "2026-09-23", now: () => miercolesDuranteLaRueda });
    const f = r.findings.filter((x) => x.check === "velas_desfasadas");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(r.graves).toBeGreaterThan(0);
  });

  it("con las velas al día no reporta nada", async () => {
    const r = await checkRun({ store: store("2026-09-22") } as never, { today: "2026-09-23", now: () => miercolesDuranteLaRueda });
    expect(r.findings.filter((x) => x.check === "velas_desfasadas")).toEqual([]);
  });
});

/**
 * El control se ancla a CUÁNDO SE ARMÓ la corrida, no a "ahora". Entre el cierre de EE.UU. y el refresco de la
 * mañana siguiente las velas están legítimamente una rueda atrás: sin este anclaje el control gritaría todas
 * las tardes con datos correctos, y un control que grita todas las tardes enseña a ignorar los graves (es la
 * misma razón por la que `precio_guardado` tolera el cierre anterior).
 */
describe("checkRun anclado al momento de la corrida", () => {
  const laTardeDespuesDelCierre = new Date("2026-09-23T22:00:00Z"); // 18:00 ET: la rueda del 23 ya cerró
  const planDeLaManana = "2026-09-23T11:34:13.798Z"; // 07:34 ET, la rueda del 23 no había empezado

  it("mirar a la tarde un plan de la mañana no reporta nada: sus velas eran las que correspondían", async () => {
    const r = await checkRun({ store: store("2026-09-22", planDeLaManana) } as never, { today: "2026-09-23", now: () => laTardeDespuesDelCierre });
    expect(r.findings.filter((x) => x.check === "velas_desfasadas")).toEqual([]);
  });

  it("pero el plan del 23/9 armado sobre los cierres del 21 sí es grave, mirado a cualquier hora", async () => {
    const r = await checkRun({ store: store("2026-09-21", planDeLaManana) } as never, { today: "2026-09-23", now: () => laTardeDespuesDelCierre });
    const f = r.findings.filter((x) => x.check === "velas_desfasadas");
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("2026-09-22");
  });
});

/**
 * `precio_vivo` (24/9): el precio del hub contra Yahoo. Como `velas_desfasadas`, en core es una función pura y
 * sin este test podría existir y no correr nunca: la corrida es la que pide los precios y arma las muestras.
 */
describe("checkRun con precios vivos", () => {
  const juevesDuranteLaRueda = new Date("2026-09-24T15:00:00Z"); // 11:00 ET
  const q = (symbol: string, price: number, asOf: string) => ({ symbol, price, prevClose: null, asOf });
  const conCartera = { ...store("2026-09-23", "2026-09-24T11:34:13.798Z"), positions: async () => [{ symbol: "GFI" }] };

  it("pide solo lo que se actúa (COMPRAR, plan, cartera) y marca grave un hub corrido", async () => {
    const pedidos: string[] = [];
    const livePrices = {
      hub: async (symbols: string[]) => symbols.map((s) => (s === "APH" ? q(s, 84.2, "2026-09-24T14:59:40Z") : q(s, 40, "2026-09-24T14:59:40Z"))),
      witness: async (s: string) => { pedidos.push(s); return s === "APH" ? q(s, 81.59, "2026-09-24T14:59:55Z") : q(s, 40.05, "2026-09-24T14:59:50Z"); },
    };
    const r = await checkRun({ store: conCartera, livePrices } as never, { today: "2026-09-24", now: () => juevesDuranteLaRueda });
    expect(pedidos.sort()).toEqual(["APH", "GFI"]);
    const f = r.findings.filter((x) => x.check.startsWith("precio_vivo"));
    expect(f).toHaveLength(1);
    expect(f[0]!).toMatchObject({ check: "precio_vivo", symbol: "APH", severity: "grave" });
    expect(r.graves).toBeGreaterThan(0);
  });

  it("lo que el hub ya marca viejo es aviso; sin la marca (CLI, sin hub) se calcula igual que la pantalla", async () => {
    const livePrices = {
      hub: async (symbols: string[]) => symbols.map((s) => (s === "APH" ? { ...q(s, 81.6, "2026-09-23T19:59:40Z"), stale: true } : q(s, 40, "2026-09-23T19:59:40Z"))),
      witness: async (s: string) => q(s, s === "APH" ? 81.59 : 40.05, "2026-09-24T14:59:55Z"),
    };
    const r = await checkRun({ store: conCartera, livePrices } as never, { today: "2026-09-24", now: () => juevesDuranteLaRueda });
    const f = r.findings.filter((x) => x.check.startsWith("precio_vivo"));
    // GFI llega sin marca: con la rueda abierta, un trade de ayer es viejo para la pantalla (quoteIsStale), así que tampoco es grave.
    expect(f.map((x) => [x.check, x.symbol, x.severity])).toEqual([["precio_vivo_viejo", "APH", "aviso"], ["precio_vivo_viejo", "GFI", "aviso"]]);
  });

  it("si Yahoo falla, cada símbolo queda como aviso sin testigo y la corrida no suma graves por eso", async () => {
    const livePrices = {
      hub: async (symbols: string[]) => symbols.map((s) => q(s, 81.59, "2026-09-24T14:59:40Z")),
      witness: async () => { throw new Error("HTTP 429 Too Many Requests"); },
    };
    const r = await checkRun({ store: conCartera, livePrices } as never, { today: "2026-09-24", now: () => juevesDuranteLaRueda });
    const f = r.findings.filter((x) => x.check.startsWith("precio_vivo"));
    expect(f.map((x) => [x.check, x.symbol, x.severity])).toEqual([["precio_vivo_sin_testigo", "APH", "aviso"], ["precio_vivo_sin_testigo", "GFI", "aviso"]]);
    expect(r.graves).toBe(0);
  });

  it("si el hub no responde, el chequeo no corre en silencio: cada símbolo queda sin hub", async () => {
    const livePrices = {
      hub: async () => { throw new Error("alpaca caído"); },
      witness: async (s: string) => q(s, 81.59, "2026-09-24T14:59:55Z"),
    };
    const r = await checkRun({ store: conCartera, livePrices } as never, { today: "2026-09-24", now: () => juevesDuranteLaRueda });
    expect(r.findings.filter((x) => x.check === "precio_vivo_sin_hub").map((x) => x.symbol)).toEqual(["APH", "GFI"]);
  });

  it("sin fuentes de precios vivos el chequeo no corre (tests y procesos que no las tienen)", async () => {
    const r = await checkRun({ store: conCartera } as never, { today: "2026-09-24", now: () => juevesDuranteLaRueda });
    expect(r.findings.filter((x) => x.check.startsWith("precio_vivo"))).toEqual([]);
  });
});
