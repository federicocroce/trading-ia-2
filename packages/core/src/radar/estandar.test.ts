import { describe, expect, it } from "vitest";
import { PLAN_BLOCKERS, assessRegime, lineHasExit, totalReturnPct, consensusUpsidePct, convictionFor, decideCandidate, isRateSensitive, maxNewPositions, planContribution, type Candle, type CandidateRow, type EtfConfig, type Fundamentals, type PlanInput, type Tags } from "../index.js";

const series = (closes: number[], start = "2025-09-01"): Candle[] => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));

describe("retorno total con dividendos", () => {
  it("SGOV: en precio da 0% y en retorno total da lo que rindió por cupón; el núcleo se compara contra eso", () => {
    // Precio clavado en 100,40 y cierre ajustado que sí acumula el cupón (0,28% mensual).
    const sgov = Array.from({ length: 253 }, (_, i) => ({ date: `d${i}`, open: 100.4, high: 100.42, low: 100.38, close: 100.4, volume: 1e6, adjClose: 97.2 * Math.pow(1.0034, i / 21) }));
    const r = totalReturnPct(sgov, 252)!;
    expect(r.pct).toBeCloseTo(4.1, 0);
    expect(r.partial).toBe(false);
  });
  it("sin cierre ajustado cae al precio y lo marca como parcial; sin historia suficiente devuelve null", () => {
    const flat = Array.from({ length: 253 }, () => ({ date: "d", open: 100.4, high: 100.4, low: 100.4, close: 100.4, volume: 1e6 }));
    expect(totalReturnPct(flat, 252)).toEqual({ pct: 0, partial: true });
    expect(totalReturnPct(flat.slice(0, 10), 252)).toBeNull();
  });
});

describe("régimen macro (pieza 4)", () => {
  const tnx = (from: number, to: number, n = 200) => series(Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1)));
  it("^TNX viene ×10; 10 años ≥ 4,5% es restrictivo, y NO genera reserva en efectivo", () => {
    const r = assessRegime(tnx(44.9, 48.4))!;
    expect(r.state).toBe("restrictivo");
    expect(r.tenYearPct).toBe(4.84);
    expect(r.change3mBp).toBeGreaterThan(0);
    expect(r.why).toContain("4.84%");
    expect(r).not.toHaveProperty("reservePct");
  });
  it("subida de 40 pb en 3 meses (63 ruedas) también es restrictivo aunque esté bajo 4,5%; bajada de 40 pb bajo 4% es expansivo; el resto neutral", () => {
    expect(assessRegime(tnx(3.7, 4.2, 64))!).toMatchObject({ state: "restrictivo", change3mBp: 50 });
    expect(assessRegime(tnx(4.3, 3.6, 64))!).toMatchObject({ state: "expansivo", change3mBp: -70 });
    expect(assessRegime(tnx(4.1, 4.15))!.state).toBe("neutral");
    expect(assessRegime([])).toBeNull();
    expect(assessRegime(series([41.2]))!.change3mBp).toBeNull();
  });
  it("sensible a tasas por sector o tema; financiero no", () => {
    expect(isRateSensitive({ sector: "Inmobiliario", themes: [] })).toBe(true);
    expect(isRateSensitive({ sector: "Materiales", themes: ["oro_mineria"] })).toBe(true);
    expect(isRateSensitive({ sector: "Financiero", themes: ["dividendos"] })).toBe(false);
    expect(isRateSensitive(null)).toBe(false);
  });
});

const up = series(Array.from({ length: 260 }, (_, i) => 80 + (20 * i) / 259));
const today = "2026-05-19";
const f: Fundamentals = { symbol: "X", asOf: today, metrics: { beta: 1, "totalDebt/totalEquityAnnual": 0.5 }, peers: [], industry: "I", mcapUsd: 20e9, dollarVolumeUsd: 50e6, nextEarnings: null, insiderBuys90d: 0, insiderSells90d: 0, analyst: null, earningsSurprises: null, priceUsd: 100 } as unknown as Fundamentals;
const policy = { technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };

describe("salvedades de precio (pieza 3)", () => {
  it("consenso en el precio: mediana de titulares (2+) a menos de 10% tras subir más de 25% → bandera; barata con objetivo cercano no; la verificación sirve si no hay titulares", () => {
    expect(consensusUpsidePct(100, { n: 3, median: 108, min: 100, max: 120, latestDate: today }, null)).toBe(8);
    expect(consensusUpsidePct(100, { n: 1, median: 108, min: 108, max: 108, latestDate: today }, 130)).toBe(30); // un solo titular no alcanza: usa la verificación
    expect(consensusUpsidePct(100, null, null)).toBeNull();
    const ran = series(Array.from({ length: 260 }, (_, i) => 70 * Math.pow(100 / 70, i / 259))); // +43% en 12 meses, suave
    const d = decideCandidate({ f, candles: ran, nthAppearance: 1, portfolioUsd: 150_000, today, analystTargets: { n: 2, median: 105, min: 100, max: 110, latestDate: today } }, policy);
    if (!("excluded" in d)) expect(d.flags).toContain("consenso_en_precio");
    const cheap = decideCandidate({ f, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, analystTargets: { n: 2, median: 105, min: 100, max: 110, latestDate: today } }, policy); // +25% justo: no subió "mucho"
    if (!("excluded" in cheap)) expect(cheap.flags).not.toContain("consenso_en_precio");
    const ok = decideCandidate({ f, candles: ran, nthAppearance: 1, portfolioUsd: 150_000, today, analystTargets: { n: 2, median: 125, min: 120, max: 130, latestDate: today } }, policy);
    if (!("excluded" in ok)) expect(ok.flags).not.toContain("consenso_en_precio");
  });
  it("subió más de 100% en 12 meses → bandera (GLW +133%); +25% no", () => {
    // 253 velas suaves: 70 → 160 (+129%) sin superar +15% en 21 ruedas.
    const runup = series(Array.from({ length: 260 }, (_, i) => 70 * Math.pow(160 / 70, i / 259)));
    const d = decideCandidate({ f, candles: runup, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if (!("excluded" in d)) expect(d.flags).toContain("subio_mucho_12m");
    const calm = decideCandidate({ f, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if (!("excluded" in calm)) expect(calm.flags).not.toContain("subio_mucho_12m");
  });
  it("21/9: la que solo frena el haber subido lleva la marca de líder, sin cambiar veredicto ni convicción", () => {
    const runup = series(Array.from({ length: 260 }, (_, i) => 70 * Math.pow(160 / 70, i / 259)));
    const sorpresa: typeof f = { ...f, earningsSurprises: [{ period: "2026-06-30", actual: 1.2, estimate: 1, surprisePercent: 20 }] };
    const d = decideCandidate({ f: sorpresa, candles: runup, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    const sinSubir = decideCandidate({ f: sorpresa, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d || "excluded" in sinSubir) throw new Error("fixture");
    expect(d.flags).toContain("subio_mucho_12m");
    expect(d.flags).toContain("sorpresa_positiva");
    // Con algo a favor y boleto, depende solo de dónde está el precio: en zona es "en retroceso"; extendida, "esperando".
    const enZona = (d.entry?.state === "en_zona" || d.entry?.state === "retroceso") && !d.flags.includes("no_perseguir") && d.target !== null;
    expect(d.flags).toContain(enZona ? "lider_en_retroceso" : "lider_esperando");
    expect(d.flags).not.toContain(enZona ? "lider_esperando" : "lider_en_retroceso");
    // No cambia el veredicto: es el mismo que sin la marca (una sola salvedad de precio no observa).
    expect(d.verdict).toBe(d.reasons.length ? "OBSERVAR" : "COMPRAR");
    expect(sinSubir.flags.some((x) => x.startsWith("lider_"))).toBe(false);
  });
  it("las dos juntas ya observan (dos salvedades de calidad o precio)", () => {
    const runup = series(Array.from({ length: 260 }, (_, i) => 70 * Math.pow(160 / 70, i / 259)));
    const d = decideCandidate({ f, candles: runup, nthAppearance: 1, portfolioUsd: 150_000, today, analystTargets: { n: 2, median: 165, min: 160, max: 170, latestDate: today } }, policy);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("OBSERVAR");
      expect(d.reasons).toEqual(["salvedades_de_calidad"]);
    }
  });
});

const row = (o: Partial<CandidateRow>): CandidateRow => ({
  candidateDate: "2026-09-10", symbol: "AAA", kind: "stock", verdict: "COMPRAR", score: 1.2, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20,
  close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 116, sizeUsd: 10_000, sizeQty: 100, riskScore: 4, flags: [], nthAppearance: 1,
  summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
  close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, ...o,
});
const tags = (sector: string, themes: string[]): Tags => ({ assetClass: "accion_us", sector, industry: null, themes, themesSource: "regla" });

describe("convicción con precio y régimen", () => {
  it("−0.3 por consenso en el precio, −0.3 por subida de 12 meses, −0.3 por sensible a tasas en régimen restrictivo", () => {
    const clean = convictionFor(row({}), null, {})!;
    const priced = convictionFor(row({ flags: ["consenso_en_precio", "subio_mucho_12m"] }), null, {})!;
    expect(priced.conviction).toBeCloseTo(clean.conviction - 0.6, 4);
    const restrictive = { state: "restrictivo" as const, asOf: "2026-09-10", tenYearPct: 4.84, change3mBp: 35, why: "10 años 4.84% (+35 pb en 3 meses): tasas altas o subiendo" };
    const reit = convictionFor(row({}), tags("Inmobiliario", ["dividendos"]), {}, {}, restrictive)!;
    expect(reit.conviction).toBeCloseTo(clean.conviction - 0.3, 4);
    expect(reit.cautions[0]).toContain("régimen restrictivo");
    const bank = convictionFor(row({}), tags("Financiero", ["bancos"]), {}, {}, restrictive)!;
    expect(bank.conviction).toBeCloseTo(clean.conviction, 4);
    const neutral = convictionFor(row({}), tags("Inmobiliario", []), {}, {}, { ...restrictive, state: "neutral" })!;
    expect(neutral.conviction).toBeCloseTo(clean.conviction, 4);
  });
});

describe("plan estandarizado (piezas 3, 4 y 5): el caso del 10/9 con USD 40.000", () => {
  const c = { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50, coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
  const core: EtfConfig[] = [
    { symbol: "VTI", name: "VTI", role: "nucleo", exposure: "rv_us", ter: 0.03, themes: [], coreWeight: 0.6 },
    { symbol: "VEA", name: "VEA", role: "nucleo", exposure: "rv_internacional", ter: 0.05, themes: [], coreWeight: 0.25 },
    { symbol: "VWO", name: "VWO", role: "nucleo", exposure: "emergentes", ter: 0.08, themes: [], coreWeight: 0.15 },
  ];
  const buy = (symbol: string, priority: number, extra: Partial<PlanInput["buyCandidates"][number]> = {}): PlanInput["buyCandidates"][number] => ({ symbol, kind: "stock", priority, score: 1.2, sizeUsd: 8000, close: 100, entryHigh: 102, stop: 92, target: 116, ...extra });
  const positions = [
    { symbol: "GGAL", valueUsd: 40_965, assetClass: "adr" as const }, { symbol: "PAM", valueUsd: 31_541, assetClass: "adr" as const }, { symbol: "YPF", valueUsd: 30_437, assetClass: "adr" as const },
    { symbol: "VIST", valueUsd: 17_296, assetClass: "adr" as const }, { symbol: "HUT", valueUsd: 14_355, assetClass: "accion_us" as const }, { symbol: "TSM", valueUsd: 11_549, assetClass: "adr" as const },
    { symbol: "MARA", valueUsd: 7_539, assetClass: "accion_us" as const }, { symbol: "NEM", valueUsd: 5_727, assetClass: "accion_us" as const },
  ];
  const input: PlanInput = {
    month: "2026-09",
    portfolioValueUsd: 159_409,
    positions,
    sumarCandidates: [{ symbol: "NEM", valueUsd: 5_727, weightPct: 3.59, stop: 121.67, target: 142.79, caution: "el ETF de su tema (GLD) está en OBSERVAR: bajo la SMA200, fuerza relativa 6m -25%" }],
    buyCandidates: [
      buy("APH", 1.4709, { verification: { verdict: "apto", reason: "pedidos +94%" } }),
      buy("NVDA", 1.4608, { verification: { verdict: "apto", reason: "superó y subió guía" } }),
      buy("HRTG", 1.4508, { verification: { verdict: "con_reservas", reason: "reservas liberadas en temporada benigna" } }),
      buy("LNC", 1.3686, { verification: { verdict: "apto", reason: "5x adelantado" } }),
      buy("SOLV", 1.3297, { verification: { verdict: "con_reservas", reason: "0,82 de EPS único" } }),
      buy("PAM", 1.2, { verification: { verdict: "apto", reason: "récord" } }),
      buy("NBN", 1.14, { verification: { verdict: "apto", reason: "ROE 23%" } }),
      buy("TER", 1.05, { flags: ["subio_mucho_12m"] }),
      { symbol: "GLW", kind: "watch", priority: -2, score: -0.33, sizeUsd: 8000, close: 168, entryHigh: 171, stop: 153, target: 199, flags: ["subio_mucho_12m"], verification: { verdict: "con_reservas", reason: "consenso en el precio" } },
    ],
    coreEtfs: core,
    spyClose: 762.4,
    closes: {},
    regime: { state: "restrictivo", asOf: "2026-09-10", tenYearPct: 4.84, change3mBp: 35, why: "10 años 4.84% (+35 pb en 3 meses): tasas altas o subiendo" },
  };
  it("sin reserva en efectivo: el aporte entero se reparte; NEM no se suma (oro en OBSERVAR); cuatro nuevas por convicción; HRTG, GLW y TER afuera con motivo", () => {
    const p = planContribution(input, c, { amountUsd: 40_000 });
    const by = Object.fromEntries(p.lines.map((l) => [`${l.kind}:${l.symbol}`, l.amountUsd]));
    // Nada en efectivo esperando: una reserva sin regla de salida rinde menos que el núcleo y se acumula sola.
    expect(p.lines.some((l) => l.symbol === "SGOV")).toBe(false);
    expect(p.lines.every(lineHasExit)).toBe(true);
    expect(p.lines.filter((l) => l.kind === "sumar")).toHaveLength(0);
    expect(p.notes.some((n) => n.startsWith("No se sumó NEM: el ETF de su tema (GLD)"))).toBe(true);
    expect(p.notes.some((n) => n.startsWith("Régimen macro al 2026-09-10: restrictivo"))).toBe(true);
    // Escalonado en vez de reserva: mismas líneas, ejecutadas en tramos.
    expect(p.tranches).toBe(3);
    expect(p.notes.some((n) => n.includes("3 tramos: USD 13.333, 13.333 y 13.334"))).toBe(true);
    // Núcleo: 60% del aporte entero, repartido 60/25/15.
    expect(by["nucleo:VTI"]).toBe(14_400);
    expect(by["nucleo:VEA"]).toBe(6_000);
    expect(by["nucleo:VWO"]).toBe(3_600);
    // Mi cartera del 10/9 era APH, NVDA, LNC y NBN, con HRTG afuera por su reserva. Desde el 18/9 (aprobado por el
    // dueño) una reserva de la verificación web no frena: HRTG, 3° por convicción, entra con la reserva escrita en su
    // línea y decide él; NBN, 7°, ya no tiene lugar entre las cuatro. La diferencia la explica esa regla y ninguna otra.
    expect(p.lines.filter((l) => l.kind === "comprar").map((l) => l.symbol)).toEqual(["APH", "NVDA", "HRTG", "LNC"]);
    expect(p.lines.find((l) => l.symbol === "HRTG")!.avisos).toEqual(["verificación web con reservas: reservas liberadas en temporada benigna"]);
    expect(maxNewPositions(40_000, 6500, 2)).toBe(4);
    expect(maxNewPositions(6_500, 6500, 2)).toBe(2);
    const left = Object.fromEntries((p.leftOut ?? []).map((x) => [x.symbol, x.reason]));
    expect(left["HRTG"]).toBeUndefined();
    expect(left["SOLV"]).toBe("5° por convicción: tope de 4 posiciones nuevas");
    expect(left["NBN"]).toBe("7° por convicción: tope de 4 posiciones nuevas");
    expect(left["PAM"]).toBe("6° por convicción: ya está en el tope del 15% por posición");
    expect(left["TER"]).toBe(`8° por convicción: ${PLAN_BLOCKERS["subio_mucho_12m"]}`);
    // La regla fija va primero (15/9): GLW subió más de 100% y eso la frena con o sin verificación.
    expect(left["GLW"]).toBe(`seguimiento: ${PLAN_BLOCKERS["subio_mucho_12m"]}`);
    const comprar = p.lines.filter((l) => l.kind === "comprar");
    expect(comprar.reduce((s, l) => s + l.amountUsd, 0) + 24_000).toBe(40_000);
    expect(comprar[0]!.amountUsd).toBeGreaterThan(comprar[3]!.amountUsd); // más convicción, más plata
    expect(p.lines.filter((l) => l.kind === "seguimiento")).toHaveLength(0);
  });

  it("invariante: una línea sin núcleo y sin stop no sale del plan y queda dicho por qué", () => {
    const sinStop: PlanInput = { ...input, sumarCandidates: [{ symbol: "NEM", valueUsd: 5_727, weightPct: 3.59, stop: null, target: null, caution: null }] };
    const p = planContribution(sinStop, c, { amountUsd: 40_000 });
    expect(p.lines.some((l) => l.symbol === "NEM")).toBe(false);
    expect(p.leftOut?.find((x) => x.symbol === "NEM")?.reason).toContain("sin salida definida");
    expect(p.notes.some((n) => n.includes("toda línea que no sea núcleo tiene que tener stop"))).toBe(true);
    expect(lineHasExit({ kind: "nucleo", stop: null })).toBe(true);
    expect(lineHasExit({ kind: "comprar", stop: 92 })).toBe(true);
    expect(lineHasExit({ kind: "sumar", stop: null })).toBe(false);
  });

  it("con el aporte mensual no se escalona y siguen dos nuevas", () => {
    const p = planContribution({ ...input, regime: { ...input.regime!, state: "neutral" } }, c);
    expect(p.tranches).toBe(1);
    expect(p.notes.some((n) => n.includes("tramos"))).toBe(false);
    expect(p.lines.filter((l) => l.kind === "comprar").map((l) => l.symbol)).toEqual(["APH", "NVDA"]);
    expect(p.notes.some((n) => n.includes("neutral"))).toBe(true);
  });
});
