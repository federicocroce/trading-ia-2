import { describe, expect, it } from "vitest";
import { AXES, AXIS_METRICS, groupMedians, peerGroup, rankStocks, robustZ, unreliableGrowthKeys, type Fundamentals } from "./index.js";

const weights = { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 };
const base = { peTTM: 20, evEbitdaTTM: 12, psTTM: 3, roeTTM: 15, operatingMarginTTM: 20, netProfitMarginTTM: 12, revenueGrowthTTMYoy: 10, revenueGrowth5Y: 8, epsGrowthTTMYoy: 10, "totalDebt/totalEquityAnnual": 0.5, currentRatioAnnual: 1.5 };
const mk = (symbol: string, industry: string | null, metrics: Record<string, number | null>, peers: string[] = []): Fundamentals => ({
  symbol, asOf: "2026-09-07", metrics, peers, industry, mcapUsd: 1e9, dollarVolumeUsd: 1e7, priceUsd: 10, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null,
});
const vary = (i: number) => Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * (1 + 0.03 * (i - 2))]));
const better = { peTTM: 10, evEbitdaTTM: 6, psTTM: 1.5, roeTTM: 30, operatingMarginTTM: 40, netProfitMarginTTM: 24, revenueGrowthTTMYoy: 20, revenueGrowth5Y: 16, epsGrowthTTMYoy: 20, "totalDebt/totalEquityAnnual": 0.25, currentRatioAnnual: 3 };
const worse = { peTTM: 40, evEbitdaTTM: 24, psTTM: 6, roeTTM: 7, operatingMarginTTM: 10, netProfitMarginTTM: 6, revenueGrowthTTMYoy: 2, revenueGrowth5Y: 1, epsGrowthTTMYoy: -5, "totalDebt/totalEquityAnnual": 1.5, currentRatioAnnual: 0.8 };

const semis = ["C1", "C2", "C3", "C4", "C5"];
const all = new Map<string, Fundamentals>([
  ["A", mk("A", "Semis", better, ["B", ...semis])],
  ["B", mk("B", "Semis", worse, ["A", ...semis])],
  ...semis.map((s, i) => [s, mk(s, "Semis", vary(i), ["A", "B", ...semis.filter((x) => x !== s)])] as [string, Fundamentals]),
  ["D", mk("D", "Semis", base, ["X", "Y"])], // pares fuera del universo → industria
  ["E", mk("E", "Rara", base, [])], // sin pares ni industria
  ["F", mk("F", "Semis", { ...base, peTTM: -5, evEbitdaTTM: null, psTTM: null }, ["A", "B", ...semis])], // sin valuación
  ["G", mk("G", "Semis", { roeTTM: 10 }, ["A", "B", ...semis])], // un solo eje
]);

describe("robustZ", () => {
  it("winsoriza a ±3 y conserva nulls", () => {
    const z = robustZ([1, 2, 3, 4, 100]);
    expect(z[4]).toBe(3);
    expect(z[2]).toBeCloseTo(0, 6);
    expect(robustZ([1, null, 3])).toEqual([expect.any(Number), null, expect.any(Number)]);
  });
  it("MAD cero → todos cero", () => expect(robustZ([5, 5, 5])).toEqual([0, 0, 0]));
});

describe("peerGroup", () => {
  it("pares dentro del universo; industria si hay pocos; null si nada", () => {
    expect(peerGroup("A", all)!.basis).toBe("pares");
    expect(peerGroup("A", all)!.members).not.toContain("A");
    expect(peerGroup("D", all)!.basis).toBe("industria");
    expect(peerGroup("E", all)).toBeNull();
  });
});

describe("rankStocks", () => {
  const { ranked, skipped } = rankStocks(all, weights);
  const by = (s: string) => ranked.find((r) => r.symbol === s)!;
  it("mejor en todo rankea primero con score positivo; peor en todo, negativo", () => {
    expect(by("A").score).toBeGreaterThan(0);
    expect(by("A").rankInGroup).toBe(1);
    expect(by("B").score).toBeLessThan(0);
    expect(ranked[0]!.symbol).toBe("A");
    expect(by("A").axes.valuation).toBeGreaterThan(0);
    expect(by("A").medians["peTTM"]).toBeCloseTo(20, 0);
  });
  it("sin pares → sin_pares; un solo eje → ejes_insuficientes", () => {
    expect(skipped).toContainEqual({ symbol: "E", reason: "sin_pares" });
    expect(skipped).toContainEqual({ symbol: "G", reason: "ejes_insuficientes" });
  });
  it("sin valuación rankea con tres ejes reponderados", () => {
    expect(by("F").axes.valuation).toBeNull();
    expect(by("F").score).not.toBeNaN();
  });
  it("orden final por score descendente", () => {
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
  });
});

/**
 * APH el 13/9. La tabla de comparables recalculaba la mediana en el navegador EXCLUYENDO a la propia empresa
 * y sin descartar los P/E no positivos: mostraba "mediana del grupo (8)" y un P/E de 67,3×, cuando el puntaje
 * usaba 66,0× sobre nueve. Estos son los P/E reales de ese día.
 */
describe("crecimiento de ingresos no confiable en bancos (NBN, 13/9)", () => {
  // NBN era 1° por convicción con ingresos +124% TTM y +133% trimestral según Finnhub; el comunicado dice +4%.
  // Contra la base del 13/9 el problema es de la fuente con los bancos, no de NBN: TFC +58%, AMTB +78%, MBWM +59%,
  // JPM +109%, cuando un banco crece de 0 a 15%. Y una regla "más de 100% sin estados" marcaba además a NBIS
  // (+488%), APLD (+365%) y ASTS, que crecen de verdad: por eso la regla es por industria y no por umbral.
  const bancos = ["B1", "B2", "B3", "B4", "B5"];
  const banco = (i: number) => ({ ...base, revenueGrowthTTMYoy: 8 + i, revenueGrowthQuarterlyYoy: 9 + i, revenueGrowth5Y: 7 + i, epsGrowthTTMYoy: 10 + i });
  // Los dos números rotos son los reales; 5 años y EPS quedan cerca de los pares para que el efecto se vea (con
  // los reales, 21,87 y 26,41, también saturan en +3 en un grupo de seis y el eje no puede subir más).
  const nbn = { ...base, revenueGrowthTTMYoy: 123.89, revenueGrowthQuarterlyYoy: 133.39, revenueGrowth5Y: 11, epsGrowthTTMYoy: 12 };
  const grupo = (f: Fundamentals) => new Map<string, Fundamentals>([["NBN", f], ...bancos.map((s, i) => [s, mk(s, "Banking", banco(i), ["NBN", ...bancos.filter((x) => x !== s)])] as [string, Fundamentals])]);
  const growth = (f: Fundamentals) => rankStocks(grupo(f), weights).ranked.find((r) => r.symbol === "NBN")!.axes.growth!;

  it("en un banco, el crecimiento de ingresos de Finnhub no entra al eje (el de 5 años y el de EPS sí)", () => {
    const roto = mk("NBN", "Banking", nbn, bancos);
    const sinEsos = mk("NBN", "Banking", { ...nbn, revenueGrowthTTMYoy: null, revenueGrowthQuarterlyYoy: null }, bancos);
    expect(unreliableGrowthKeys(roto)).toEqual(["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"]);
    expect(growth(roto)).toBeCloseTo(growth(sinEsos), 4);
  });
  it("fuera de los bancos no cambia nada, ni siquiera con crecimientos enormes (NBIS +488%, sin estados)", () => {
    expect(unreliableGrowthKeys(mk("NBIS", "Technology", { ...base, revenueGrowthTTMYoy: 488.2, revenueGrowthQuarterlyYoy: 454 }))).toEqual([]);
  });
});

describe("groupMedians", () => {
  const pe = (v: number | null) => ({ metrics: { peTTM: v } as Record<string, number | null> });
  const aph = pe(39.7);
  const pares = [pe(70.0), pe(68.6), pe(null), pe(66.0), pe(19.6), pe(null), pe(44.9), pe(73.0)];

  it("incluye a la propia empresa: es la mediana contra la que el puntaje la mide", () => {
    expect(groupMedians([aph, ...pares])["peTTM"]).toBe(66.0);
  });

  it("sin la propia daba otro número, que era el que mostraba la pantalla", () => {
    expect(groupMedians(pares)["peTTM"]).toBeCloseTo(67.3, 1);
  });

  it("un P/E negativo no es barato, es no ganar plata: no entra en la mediana", () => {
    expect(groupMedians([pe(10), pe(20), pe(-500)])["peTTM"]).toBe(15);
  });
});

/**
 * El costo del ranking (18/9). Agregar un ticker a la lista de seguimiento tardaba unos 10 minutos y en el medio la
 * API no contestaba nada: `rankStocks` sobre los 2.724 símbolos del universo eran 85–90 s de CPU sin soltar el hilo.
 * Por cada símbolo se puntuaba a cada miembro de su grupo, y cada puntaje recalculaba el z del grupo entero: cúbico
 * en el tamaño del grupo. Con diez pares no se nota; 641 símbolos caen al grupo por industria (mediana 82, máximo
 * 190) y eran el 99,9% del costo. La regla: el z de cada métrica se calcula una vez por grupo. Con eso el mismo
 * universo tarda 1,6 s y la salida es idéntica (mismos 2.684 rankeados, puntajes, ejes, medianas, orden y descartes).
 */
describe("rankStocks: una pasada por grupo (alta a la lista de seguimiento, 18/9)", () => {
  const azar = (semilla: number) => () => (semilla = (semilla * 1664525 + 1013904223) % 4294967296) / 4294967296;
  /** Una industria sin pares declarados: todos caen al grupo por industria, que es el caso caro. `lecturas` cuenta cada métrica leída. */
  const industria = (nombre: string, n: number, semilla: number, lecturas?: { n: number }): Array<[string, Fundamentals]> => {
    const r = azar(semilla);
    return Array.from({ length: n }, (_, i) => {
      const crudas: Record<string, number | null> = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, r() < 0.1 ? null : v * (0.4 + 1.6 * r())]));
      if (i % 7 === 0) crudas["peTTM"] = -3; // pierde plata: el P/E negativo no entra
      const metrics = lecturas ? new Proxy(crudas, { get: (t, k) => { lecturas.n++; return t[k as string]; } }) : crudas;
      return [`${nombre}${i}`, mk(`${nombre}${i}`, nombre, metrics)] as [string, Fundamentals];
    });
  };

  it("duplicar el grupo multiplica el trabajo por cuatro, no por ocho", () => {
    const lecturasDe = (n: number) => { const l = { n: 0 }; rankStocks(new Map(industria("Ind", n, 7, l)), weights); return l.n; };
    expect(lecturasDe(40) / lecturasDe(20)).toBeLessThan(5);
  });

  it("el puntaje y el lugar en el grupo siguen siendo los de la definición: z robusto de cada métrica dentro del grupo", () => {
    const universo = new Map<string, Fundamentals>([...industria("Semis", 30, 1), ...industria("Banks", 12, 2), ...all]);
    const valor = (f: Fundamentals, spec: { key: string; positiveOnly?: boolean }) => { const v = f.metrics[spec.key]; return v === null || v === undefined || !Number.isFinite(v) || unreliableGrowthKeys(f).includes(spec.key) || (spec.positiveOnly && v <= 0) ? null : v; };
    const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
    const segunDefinicion = (f: Fundamentals, set: Fundamentals[]) => {
      const i = set.indexOf(f);
      const ejes = AXES.map((eje) => { const zs = AXIS_METRICS[eje].flatMap((spec) => { const z = robustZ(set.map((m) => valor(m, spec)))[i]; return z === null || z === undefined ? [] : [spec.invert ? -z : z]; }); return zs.length ? r4(zs.reduce((a, b) => a + b, 0) / zs.length) : null; });
      const hay = AXES.map((eje, k) => ({ eje, v: ejes[k]! })).filter((e) => e.v !== null);
      return hay.length <= 1 ? null : r4(hay.reduce((s, e) => s + weights[e.eje] * e.v, 0) / hay.reduce((s, e) => s + weights[e.eje], 0));
    };
    const { ranked } = rankStocks(universo, weights);
    expect(ranked.length).toBeGreaterThan(40);
    for (const fila of ranked) {
      const f = universo.get(fila.symbol)!;
      const set = [f, ...fila.group.map((s) => universo.get(s)!)];
      expect([fila.symbol, fila.score]).toEqual([fila.symbol, segunDefinicion(f, set)]);
      const mejores = set.filter((m) => (segunDefinicion(m, set) ?? Number.NEGATIVE_INFINITY) > fila.score).length;
      expect([fila.symbol, fila.rankInGroup]).toEqual([fila.symbol, mejores + 1]);
    }
  });
});

