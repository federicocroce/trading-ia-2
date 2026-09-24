import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { atr, buildFlags, buildQuarters, clasificarHecho, computeTrailingStop, consensusTargetOf, consensusUpsidePct, coreEarnings, decideCandidate, dividendoNoComprobable, ENTRY_STOP_ATR, positionSize, riskScore, technicalGate, type Candle, type CompanyFactsJson, type Fundamentals } from "../index.js";

const series = (closes: number[], start = "2025-09-01", volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume }));
const up = series(Array.from({ length: 260 }, (_, i) => 80 + (20 * i) / 259)); // 80 → 100, última 2026-05-18
const today = "2026-05-19";
const tech = { maxReturn21dPct: 15, earningsWithinDays: 10 };
const sizing = { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 };
const f = (over: Partial<Fundamentals> = {}): Fundamentals => ({ symbol: "X", asOf: today, metrics: { beta: 1, "totalDebt/totalEquityAnnual": 0.5, dividendYieldIndicatedAnnual: 1 }, peers: [], industry: "I", mcapUsd: 20e9, dollarVolumeUsd: 50e6, priceUsd: 100, nextEarnings: null, insiderBuys90d: 0, insiderSells90d: 0, analyst: null, earningsSurprises: null, ...over });

describe("technicalGate", () => {
  it("normal → ok con sma200, retorno 21 y atr", () => {
    const g = technicalGate(up, tech, null, today);
    expect(g.status).toBe("ok");
    expect(g.sma200).toBeLessThan(g.close);
    expect(g.return21dPct).toBeCloseTo(1.6, 0);
    expect(g.atrPct).toBeGreaterThan(0);
  });
  it("bajo SMA200 → excluido", () => {
    const down = series(Array.from({ length: 260 }, (_, i) => 100 - (20 * i) / 259));
    expect(technicalGate(down, tech, null, today)).toMatchObject({ status: "excluido", reasons: ["bajo_sma200"] });
  });
  it("subió > 15% en 21 velas → observar no_perseguir", () => {
    const spike = [...up.slice(0, 239), ...series(Array(21).fill(125), up[239]!.date)];
    expect(technicalGate(spike, tech, null, today)).toMatchObject({ status: "observar", reasons: ["no_perseguir"] });
  });
  it("resultados en ≤ 10 días → observar resultados_cerca", () => {
    expect(technicalGate(up, tech, "2026-05-25", today)).toMatchObject({ status: "observar", reasons: ["resultados_cerca"] });
    expect(technicalGate(up, tech, "2026-07-01", today).status).toBe("ok");
  });
  it("< 200 velas → excluido sin_historial", () => {
    expect(technicalGate(up.slice(-100), tech, null, today)).toMatchObject({ status: "excluido", reasons: ["sin_historial"] });
  });
});

describe("positionSize", () => {
  it("1% de riesgo entre entrada y stop, con tope del 10% de la cartera", () => {
    expect(positionSize({ entryHigh: 102, stop: 92, portfolioUsd: 150_000 }, sizing)).toEqual({ qty: 147, sizeUsd: 14_994, riskUsd: 1_500 });
    expect(positionSize({ entryHigh: 102, stop: 100, portfolioUsd: 150_000 }, sizing)).toEqual({ qty: 147, sizeUsd: 14_994, riskUsd: 1_500 });
  });
  it("sin stop o stop ≥ entrada → null; sin cartera usa el fallback", () => {
    expect(positionSize({ entryHigh: 102, stop: null, portfolioUsd: 150_000 }, sizing)).toBeNull();
    expect(positionSize({ entryHigh: 102, stop: 102, portfolioUsd: 150_000 }, sizing)).toBeNull();
    expect(positionSize({ entryHigh: 102, stop: 92, portfolioUsd: null }, sizing)!.riskUsd).toBe(1_500);
  });
});

describe("riskScore", () => {
  it("todo bajo → 1; todo alto → 10 (tope)", () => {
    expect(riskScore({ beta: 0.8, atrPct: 1.5, debtToEquity: 0.3, dollarVolumeUsd: 100e6, mcapUsd: 50e9 })).toBe(1);
    expect(riskScore({ beta: 2, atrPct: 5, debtToEquity: 2, dollarVolumeUsd: 6e6, mcapUsd: 1e9 })).toBe(10);
    expect(riskScore({ beta: 1.3, atrPct: 3, debtToEquity: 1, dollarVolumeUsd: 20e6, mcapUsd: 5e9 })).toBe(6);
    expect(riskScore({ beta: null, atrPct: null, debtToEquity: null, dollarVolumeUsd: 100e6, mcapUsd: 50e9 })).toBe(1);
    expect(riskScore({ beta: null, atrPct: null, debtToEquity: null, dollarVolumeUsd: 100e6, mcapUsd: null })).toBe(3); // capitalización desconocida (ADR) cuenta como chica
  });
});

describe("buildFlags", () => {
  const gate = technicalGate(up, tech, null, today);
  it("cada bandera con su caso", () => {
    expect(buildFlags(f({ insiderBuys90d: 2 }), gate, 1, 4)).toContain("insiders_compran");
    expect(buildFlags(f({ insiderSells90d: 3 }), gate, 1, 4)).toContain("insiders_venden");
    expect(buildFlags(f({ analyst: { strongBuy: 5, buy: 5, hold: 2, sell: 0, strongSell: 0, period: "p" } }), gate, 1, 4)).toContain("consenso_compra");
    expect(buildFlags(f({ analyst: { strongBuy: 0, buy: 1, hold: 2, sell: 3, strongSell: 2, period: "p" } }), gate, 1, 4)).toContain("consenso_venta");
    expect(buildFlags(f({ earningsSurprises: [{ period: "q", surprisePercent: 8 }] }), gate, 1, 4)).toContain("sorpresa_positiva");
    expect(buildFlags(f({ earningsSurprises: [{ period: "q", surprisePercent: -8 }] }), gate, 1, 4)).toContain("sorpresa_negativa");
    expect(buildFlags(f({ priceUsd: 100, metrics: { dividendPerShareTTM: 3 } }), gate, 1, 4)).toContain("dividendo:3");
    expect(buildFlags(f(), gate, 4, 4)).toContain("residente_cronico");
    expect(buildFlags(f(), gate, 1, 4)).toEqual([]);
  });
  it("MCY del 16/9: el rendimiento sale del dividendo que la empresa pagó, no del 'indicado' de Finnhub", () => {
    // El 16/9/2026 la base decía dividendYieldIndicatedAnnual 3,44% para MCY, y MCY paga 0,3175 por trimestre:
    // 1,27 al año sobre 101,93 = 1,25%. En HCI decía 1,83% y paga 1,60 al año sobre 188,06 = 0,85%. La bandera se
    // pintaba verde con el campo equivocado en 148 de las 1.335 empresas que tienen los dos datos.
    const mcy = f({ symbol: "MCY", priceUsd: 101.93, metrics: { dividendYieldIndicatedAnnual: 3.44453, dividendPerShareTTM: 1.27 } });
    expect(buildFlags(mcy, gate, 1, 4).some((x) => x.startsWith("dividendo"))).toBe(false);
    const hci = f({ symbol: "HCI", priceUsd: 188.06, metrics: { dividendYieldIndicatedAnnual: 1.83045, dividendPerShareTTM: 1.6236 } });
    expect(buildFlags(hci, gate, 1, 4).some((x) => x.startsWith("dividendo"))).toBe(false);
    // MO el mismo día: 4,2153 sobre 68,87 = 6,1%. Ésa sí paga.
    const mo = f({ symbol: "MO", priceUsd: 68.87, metrics: { dividendYieldIndicatedAnnual: 9.45262, dividendPerShareTTM: 4.2153 } });
    // La bandera lleva el número para poder contrastarlo: 4,2153 sobre 68,87 = 6,12%.
    expect(buildFlags(mo, gate, 1, 4)).toContain("dividendo:6.12");
  });
  it("24/9: un dividendo que no se puede comprobar no se muestra (MYE, PBR); uno alto que sí cierra, sí (ABR)", () => {
    const tiene = (x: Parameters<typeof buildFlags>[0]) => buildFlags(x, gate, 1, 4).some((b) => b.startsWith("dividendo"));
    // MYE: Finnhub daba 8,40 de dividendo en 12 meses (27%) y 0,55 anual; la empresa paga 0,135 por trimestre.
    expect(tiene(f({ symbol: "MYE", priceUsd: 30.99, currency: "USD", metrics: { dividendPerShareTTM: 8.4013, dividendPerShareAnnual: 0.5491 } }))).toBe(false);
    // PBR: reporta en reales. 3,17 BRL sobre un ADR de 21,14 USD daba "15%".
    expect(tiene(f({ symbol: "PBR", priceUsd: 21.14, currency: "BRL", metrics: { dividendPerShareTTM: 3.17, dividendPerShareAnnual: 3.17 } }))).toBe(false);
    // ABR (mREIT, en dólares): 26% es alto pero los dos campos coinciden. Se muestra.
    expect(buildFlags(f({ symbol: "ABR", priceUsd: 5.25, currency: "USD", metrics: { dividendPerShareTTM: 1.397, dividendPerShareAnnual: 1.6631 } }), gate, 1, 4)).toContain("dividendo:26.61");
    // Sin moneda guardada (filas de antes de la migración): como antes.
    expect(buildFlags(f({ priceUsd: 100, metrics: { dividendPerShareTTM: 3 } }), gate, 1, 4)).toContain("dividendo:3");
    expect(dividendoNoComprobable(f({ symbol: "MYE", priceUsd: 30.99, currency: "USD", metrics: { dividendPerShareTTM: 8.4013, dividendPerShareAnnual: 0.5491 } }))).toMatch(/8,4.*0,55/);
    expect(dividendoNoComprobable(f({ symbol: "PBR", priceUsd: 21.14, currency: "BRL", metrics: { dividendPerShareTTM: 3.17 } }))).toMatch(/BRL/);
    expect(dividendoNoComprobable(f({ symbol: "ABR", priceUsd: 5.25, currency: "USD", metrics: { dividendPerShareTTM: 1.397, dividendPerShareAnnual: 1.6631 } }))).toBeNull();
  });
  it("sin el dividendo pagado no se afirma que paga, aunque el campo 'indicado' diga que sí", () => {
    expect(buildFlags(f({ metrics: { dividendYieldIndicatedAnnual: 6 } }), gate, 1, 4).some((x) => x.startsWith("dividendo"))).toBe(false);
  });
  it("AES del 16/9: una empresa con la fusión ya votada no se valúa con las reglas del Radar", () => {
    // El Radar la ponía 77ª, COMPRAR, con objetivo 15,93 contra un acuerdo en efectivo a 15,00.
    expect(buildFlags(f({ symbol: "AES" }), gate, 1, 4, { filings: ["DEFM14A — THE AES CORPORATION", "10-Q — THE AES CORPORATION"] })).toContain("bajo_oferta_de_compra");
    expect(buildFlags(f(), gate, 1, 4, { filings: ["10-Q — Empresa Inc."] })).not.toContain("bajo_oferta_de_compra");
    expect(buildFlags(f(), gate, 1, 4)).not.toContain("bajo_oferta_de_compra");
  });
  it("NBN del 14/9: un banco sin estados de la SEC legibles lleva banco_sin_estados (no entra al plan)", () => {
    // La verificación web del 14/9 la dio "apta" diciendo que no hubo extraordinarios (hubo créditos fiscales comprados
    // y reservas liberadas) y que no encontró el inmobiliario comercial sobre capital (485% en el mismo comunicado).
    expect(buildFlags(f({ industry: "Banking" }), gate, 1, 4, { core: null })).toContain("banco_sin_estados");
    expect(buildFlags(f({ industry: "Technology" }), gate, 1, 4, { core: null })).not.toContain("banco_sin_estados");
  });
  it("NBN del 13/9: en un banco, el crecimiento de ingresos de Finnhub no se usa y la fila lo dice", () => {
    const nbn = { beta: 0.65, revenueGrowthTTMYoy: 123.89, revenueGrowthQuarterlyYoy: 133.39 };
    expect(buildFlags(f({ industry: "Banking", metrics: nbn }), gate, 1, 4)).toContain("crecimiento_no_confiable");
    expect(buildFlags(f({ industry: "Technology", metrics: nbn }), gate, 1, 4)).not.toContain("crecimiento_no_confiable");
  });
});

describe("consensusUpsidePct", () => {
  const t = (median: number) => ({ n: 10, median, min: median, max: median, latestDate: "2026-08-20" });
  it("con el consenso en escala devuelve el potencial", () => {
    expect(consensusUpsidePct(100, t(112), null)).toBe(12);
    // ZVRA: biotech caído a 12,57 con objetivos de 20 a 24. Son creíbles y tienen que seguir contando.
    expect(consensusUpsidePct(12.57, t(24), null)).toBeGreaterThan(0);
  });
  it("APH del 10/9: una mediana de otra escala no produce potencial en vez de producir uno inventado", () => {
    // 196 con la acción en 80,25 tras un split 2:1 daba +144%. Ahora no da nada y el chequeo lo reporta.
    expect(consensusUpsidePct(80.25, t(196), null)).toBeNull();
    expect(consensusUpsidePct(100, t(40), null)).toBeNull();
  });
  it("APH del 13/9: si la mediana de titulares está fuera de escala (split), vale el consenso de la verificación web", () => {
    // Los titulares tenían 196 (antes del 2 por 1) y la verificación 100,6. La tarjeta decía "sin consenso".
    expect(consensusTargetOf(83.92, t(196), 100.6)).toBe(100.6);
    expect(consensusTargetOf(83.92, t(196), null)).toBeNull();
  });
  it("el consenso de la verificación web pasa por la misma banda", () => {
    expect(consensusUpsidePct(80.25, null, 196)).toBeNull();
    expect(consensusUpsidePct(80.25, null, 88)).toBeGreaterThan(0);
  });
});

describe("decideCandidate", () => {
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("normal → COMPRAR con entrada, stop, objetivo, tamaño y riesgo", () => {
    const d = decideCandidate({ f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.verdict).toBe("COMPRAR");
    expect(d.entryLow).toBe(100);
    expect(d.entryHigh).toBe(102);
    // El precio de entrada ya no es un 2% inventado: sale del momento de entrada y coincide con él.
    expect(d.entry!.state).toBe("en_zona");
    expect(d.entry!.level).toBe(d.entryHigh);
    expect(d.stop).toBeLessThan(100);
    expect(d.target).toBeGreaterThan(100);
    expect(d.size!.qty).toBeGreaterThan(0);
    expect(d.riskScore).toBeGreaterThanOrEqual(1);
  });
  it("cierre bajo el stop dinámico (viene cayendo desde un máximo reciente) → OBSERVAR sin tamaño", () => {
    // sube 80→110 y en las últimas 5 velas cae a 100: sigue sobre la SMA200 pero bajo el chandelier
    const closes = [...Array.from({ length: 255 }, (_, i) => 80 + (30 * i) / 254), 108, 105, 103, 101, 100];
    const c = series(closes);
    const d = decideCandidate({ f: f(), candles: c, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.stop).toBeGreaterThan(100); // el stop quedó arriba del cierre: la tendencia se dio vuelta
    expect(d.verdict).toBe("OBSERVAR");
    // Cayó bajo su media de 50: no se compra la caída, se espera que recupere el máximo reciente.
    expect(d.entry!.state).toBe("esperar_confirmacion");
    expect(d.entryLow).toBeGreaterThan(100);
    expect(d.flags).toContain("bajo_stop");
    expect(d.size).toBeNull();
    expect(d.target).toBeNull();
  });
  it("el cierre es el cierre, aunque la franja de compra quede arriba: no se puede tomar entryLow como precio", () => {
    // Cayó bajo su media de 50: la franja arranca en el máximo de las últimas 10 ruedas, muy arriba del cierre.
    // Quien guarda la fila usaba entryLow como precio; si vuelve a hacerlo, la base queda con un precio inventado.
    const closes = [...Array.from({ length: 255 }, (_, i) => 80 + (30 * i) / 254), 108, 105, 103, 101, 100];
    const d = decideCandidate({ f: f(), candles: series(closes), nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.close).toBe(100);
    expect(d.entryLow).toBeGreaterThan(d.close);
  });
  it("cuando hay objetivo, el 2 a 1 se mide desde el precio que se paga y nunca queda debajo", () => {
    // Antes el objetivo salía del cierre mientras la entrada salía de otro lado: CLS mostraba "2 a 1"
    // siendo 52 a 1, y ALL, MNPR, CARE y GOOGL tenían el objetivo POR DEBAJO del precio de entrada.
    const fixtures: Candle[][] = [
      up,
      series([...Array.from({ length: 200 }, (_, i) => 60 + i * 0.2), ...Array(60).fill(100), ...Array(3).fill(112)]),
      series([...Array.from({ length: 255 }, (_, i) => 80 + (30 * i) / 254), 108, 105, 103, 101, 100]),
      series([...Array.from({ length: 220 }, (_, i) => 60 + i * 0.3), 128, 126, 124, 123, 122.5]),
    ];
    let conObjetivo = 0;
    for (const c of fixtures) {
      const d = decideCandidate({ f: f(), candles: c, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
      if ("excluded" in d || d.target === null) continue;
      conObjetivo++;
      expect(d.stop).not.toBeNull();
      expect(d.stop!).toBeLessThan(d.entryLow); // el boleto se puede ejecutar
      expect(d.target!).toBeGreaterThan(d.entryHigh); // nunca nace perdida
      expect(d.target! - d.entryHigh).toBeCloseTo(2 * (d.entryHigh - d.stop!), 1);
    }
    expect(conObjetivo).toBeGreaterThan(0);
  });

  it("PAM del 12/9: si el stop no queda debajo de toda la franja, el boleto no se puede ejecutar", () => {
    // Comprando en el piso ya estarías debajo del stop: sin objetivo, sin tamaño y con el motivo dicho.
    const closes = [...Array.from({ length: 220 }, (_, i) => 60 + i * 0.3), 128, 126, 124, 123, 122.5];
    const d = decideCandidate({ f: f(), candles: series(closes), nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    if (d.stop !== null && d.stop < d.entryLow) return; // el fixture quedó ejecutable: nada que probar
    expect(d.target).toBeNull();
    expect(d.size).toBeNull();
    expect(d.flags).toContain("stop_dentro_de_la_entrada");
    expect(d.verdict).toBe("OBSERVAR");
  });

  describe("stop de una compra nueva (NVDA y V del 13/9)", () => {
    // Sube a 114 en 3 ruedas, vuelve a 109 y queda plana: COMPRAR "en zona" con el stop de seguimiento a 0,35 ATR,
    // el mismo cuadro que NVDA (214,89 contra 218,29, 0,44 ATR) y V (0,41 ATR) el 13/9.
    const pullback = series([
      ...Array.from({ length: 240 }, (_, i) => 80 + (30 * i) / 239),
      ...[1, 2, 3].map((i) => 110 + (4 * i) / 3),
      ...[1, 2, 3].map((i) => 114 - (5 * i) / 3),
      ...Array(14).fill(109),
    ]);
    it("el stop queda a 2,5 ATR del piso de la franja, no pegado al precio", () => {
      const d = decideCandidate({ f: f(), candles: pullback, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
      if ("excluded" in d) throw new Error("no debía excluir");
      expect(d.verdict).toBe("COMPRAR");
      const trailing = computeTrailingStop(pullback)!;
      expect((d.close - trailing) / atr(pullback, 14)!).toBeLessThan(0.5);
      expect(d.stop).toBeCloseTo(d.entryLow - ENTRY_STOP_ATR * atr(pullback, 14)!, 2);
      expect(d.target! - d.entryHigh).toBeCloseTo(2 * (d.entryHigh - d.stop!), 1);
    });
    it("si ya está en cartera, el stop es el de la posición: una posición tiene un solo stop", () => {
      const d = decideCandidate({ f: f(), candles: pullback, nthAppearance: 1, portfolioUsd: 150_000, today, held: true }, policy);
      if ("excluded" in d) throw new Error("no debía excluir");
      expect(d.stop).toBe(computeTrailingStop(pullback));
      expect(d.target! - d.entryHigh).toBeCloseTo(2 * (d.entryHigh - d.stop!), 1);
    });
    it("no cambia ningún veredicto: el filtro sigue siendo el stop de seguimiento", () => {
      const cayendo = series([...Array.from({ length: 255 }, (_, i) => 80 + (30 * i) / 254), 108, 105, 103, 101, 100]);
      const d = decideCandidate({ f: f(), candles: cayendo, nthAppearance: 1, portfolioUsd: 150_000, today }, policy);
      if ("excluded" in d) throw new Error("no debía excluir");
      expect(d.verdict).toBe("OBSERVAR");
      expect(d.flags).toContain("bajo_stop");
      expect(d.stop).toBe(computeTrailingStop(cayendo));
    });
  });

  it("residente crónico → OBSERVAR", () => {
    const d = decideCandidate({ f: f(), candles: up, nthAppearance: 4, portfolioUsd: null, today }, policy);
    if ("excluded" in d) throw new Error("no debía excluir");
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.flags).toContain("residente_cronico");
  });
  it("bajo SMA200 → excluido", () => {
    const down = series(Array.from({ length: 260 }, (_, i) => 100 - (20 * i) / 259));
    expect(decideCandidate({ f: f(), candles: down, nthAppearance: 1, portfolioUsd: null, today }, policy)).toEqual({ excluded: true, reasons: ["bajo_sma200"] });
  });
});

/**
 * 17/9: ROKU con el DEFM14A del 1/9 (Fox paga 96 en efectivo más 0,9693 FOXA) seguía COMPRAR con objetivo 170,99.
 * Una fila que dice COMPRAR se compra (regla del 14/9), y un precio fijado por contrato no es una compra: la oferta
 * pasa a ser motivo de OBSERVAR, no sólo bloqueo del plan.
 */
describe("decideCandidate bajo oferta de compra", () => {
  const p = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("con un DEFM14A la fila queda OBSERVAR y dice por qué", () => {
    const d = decideCandidate({ f: f({ symbol: "ROKU" }), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, filings: ["DEFM14A — ROKU, INC."] }, p);
    expect("excluded" in d).toBe(false);
    if ("excluded" in d) return;
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.flags).toContain("bajo_oferta_de_compra");
    expect(d.reasons).toContain("bajo_oferta_de_compra");
  });
  it("sin formularios de oferta sigue COMPRAR", () => {
    const d = decideCandidate({ f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, filings: ["10-Q — Empresa Inc."] }, p);
    if ("excluded" in d) throw new Error("no debería excluir");
    expect(d.verdict).toBe("COMPRAR");
  });
  it("un hecho de oferta verificado hace lo mismo que el formulario; uno de guía subida suma la bandera sin cambiar el veredicto", () => {
    const base = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: `${today}T00:00:00.000Z` };
    const oferta = clasificarHecho({ tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2026-03-01", valor: { comprador: "AWK", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "PUC", cierreEsperado: null, formulario: "425" }, fuente: { url: "https://www.sec.gov/a", titulo: "425" } }, base);
    const d1 = decideCandidate({ f: f({ symbol: "WTRG" }), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, hechos: [oferta] }, p);
    if ("excluded" in d1) throw new Error("no debería excluir");
    expect(d1.verdict).toBe("OBSERVAR");
    expect(d1.flags).toContain("bajo_oferta_de_compra");
    const guiaSube = clasificarHecho({ tipo: "guia", symbol: "FIVE", fecha: "2026-05-10", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: "8", despues: "9" }, fuente: { url: "https://www.sec.gov/b", titulo: "8-K" } }, base);
    const d2 = decideCandidate({ f: f({ symbol: "FIVE" }), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, hechos: [guiaSube] }, p);
    if ("excluded" in d2) throw new Error("no debería excluir");
    expect(d2.verdict).toBe("COMPRAR");
    expect(d2.flags).toContain("guia_subida");
  });
});

describe("decideCandidate con estados", () => {
  const zvra = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8")) as CompanyFactsJson;
  const core = coreEarnings(buildQuarters(zvra));
  const base = { candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("desvío > 25% → resultado_extraordinario; sigue COMPRAR", () => {
    const d = decideCandidate({ f: f(), ...base, core }, policy);
    expect("excluded" in d).toBe(false);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("COMPRAR");
      expect(d.flags).toContain("resultado_extraordinario");
    }
  });
  it("core null → sin_estados; undefined → ninguna de las dos", () => {
    const a = decideCandidate({ f: f(), ...base, core: null }, policy);
    const b = decideCandidate({ f: f(), ...base }, policy);
    if (!("excluded" in a)) expect(a.flags).toContain("sin_estados");
    if (!("excluded" in b)) expect(b.flags).not.toEqual(expect.arrayContaining(["sin_estados", "resultado_extraordinario"]));
  });
  it("desvío chico → sin bandera", () => {
    const d = decideCandidate({ f: f(), ...base, core: { ...core!, deviationPct: 0.1 } }, policy);
    if (!("excluded" in d)) expect(d.flags).not.toContain("resultado_extraordinario");
  });
});

describe("decideCandidate con eventos", () => {
  const base = { f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  const ev = (date: string, severity: "grave" | "moderado" | "ruido") => ({ date, kind: "regulatorio" as const, severity, headline: `evento ${severity}` });
  it("grave en 90 días → OBSERVAR con motivo evento_grave", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-04-01", "grave")] }, policy);
    expect(d).toMatchObject({ verdict: "OBSERVAR", reasons: ["evento_grave"] });
    if (!("excluded" in d)) expect(d.flags).toContain("evento_grave");
  });
  it("grave de hace 91 días ya no cuenta", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-02-17", "grave")] }, policy); // today 2026-05-19
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) expect(d.flags).not.toContain("evento_grave");
  });
  it("moderado → sigue COMPRAR con bandera; ruido no deja bandera", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-05-01", "moderado"), ev("2026-05-02", "ruido")] }, policy);
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) {
      expect(d.flags).toContain("evento_moderado");
      expect(d.flags).not.toContain("evento_grave");
    }
  });
  it("sin clasificar → bandera eventos_sin_clasificar, sigue COMPRAR", () => {
    const d = decideCandidate({ ...base, eventsUnclassified: true }, policy);
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) expect(d.flags).toContain("eventos_sin_clasificar");
  });
});
