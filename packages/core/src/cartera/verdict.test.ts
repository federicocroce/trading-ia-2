import { describe, expect, it } from "vitest";
import { applyDegrade, decideVerb, isStale, sumarCriteria, type Candle } from "./index.js";

const mk = (closes: number[], startDay = 1): Candle[] =>
  closes.map((c, i) => {
    const d = new Date(Date.UTC(2026, 7, startDay + i)); // agosto 2026 en adelante
    return { date: d.toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume: 1_000_000 };
  });
const flat30 = mk(Array(30).fill(100)); // stop = 101 - 3*2 = 95, última vela 2026-08-30
const base = { spot: 100, avgCost: 80, layer: "riesgo" as const, weightPct: 20, positionsCount: 5, today: "2026-08-31" };

describe("isStale", () => {
  it("más de 4 días calendario es viejo", () => {
    expect(isStale("2026-08-26", "2026-08-31")).toBe(true);
    expect(isStale("2026-08-27", "2026-08-31")).toBe(false);
  });
});

describe("decideVerb", () => {
  it("precio viejo → REVISAR con aviso, aunque haya stop", () => {
    const v = decideVerb({ ...base, candles: flat30, today: "2026-09-10" });
    expect(v.verb).toBe("REVISAR");
    expect(v.stale).toBe(true);
    expect(v.warning).toMatch(/no está vigilando/i);
    expect(v.reason).toMatch(/no pude cotizar/i);
  });
  it("cierre bajo el stop → VENDER", () => {
    const c = [...flat30.slice(0, 29), { ...flat30[29]!, close: 94, low: 93 }];
    const v = decideVerb({ ...base, candles: c });
    expect(v.verb).toBe("VENDER");
    expect(v.stop).not.toBeNull();
    expect(v.close).toBe(94);
  });
  it("capa núcleo bajo el stop → MANTENER con aviso", () => {
    const c = [...flat30.slice(0, 29), { ...flat30[29]!, close: 94, low: 93 }];
    const v = decideVerb({ ...base, candles: c, layer: "nucleo" });
    expect(v.verb).toBe("MANTENER");
    expect(v.warning).toMatch(/nucleo/i);
  });
  it("spot intradiario bajo el stop sin cierre abajo → MANTENER con aviso", () => {
    const v = decideVerb({ ...base, candles: flat30, spot: 94 });
    expect(v.verb).toBe("MANTENER");
    expect(v.warning).toMatch(/cierre/i);
  });
  it("sin velas suficientes → MANTENER con aviso y sin stop", () => {
    const v = decideVerb({ ...base, candles: mk(Array(10).fill(100), 21) });
    expect(v.verb).toBe("MANTENER");
    expect(v.stop).toBeNull();
    expect(v.warning).toMatch(/stop/i);
  });
  it("sin velas → REVISAR", () => {
    const v = decideVerb({ ...base, candles: [] });
    expect(v.verb).toBe("REVISAR");
    expect(v.stale).toBe(true);
  });
  it("todo en orden → MANTENER con stop y objetivo", () => {
    const v = decideVerb({ ...base, candles: flat30 });
    expect(v.verb).toBe("MANTENER");
    expect(v.stop).toBe(95);
    expect(v.target).toBe(110);
    expect(v.gainPct).toBe(25);
  });
  it("subponderada, arriba del stop y sin perseguir → SUMAR", () => {
    const v = decideVerb({ ...base, candles: flat30, weightPct: 10 }); // igualitario 20, 80% = 16
    expect(v.verb).toBe("SUMAR");
  });
});

describe("sumarCriteria", () => {
  const ok = { weightPct: 10, positionsCount: 5, close: 100, stop: 95, return21dPct: 5 };
  it("cumple las tres", () => expect(sumarCriteria(ok).ok).toBe(true));
  it("no si pesa ≥ 80% del igualitario", () => expect(sumarCriteria({ ...ok, weightPct: 16 }).ok).toBe(false));
  it("no si está bajo el stop", () => expect(sumarCriteria({ ...ok, close: 94 }).ok).toBe(false));
  it("no si subió más de 15% en 21 velas", () => expect(sumarCriteria({ ...ok, return21dPct: 16 }).ok).toBe(false));
  it("no sin stop ni sin retorno", () => {
    expect(sumarCriteria({ ...ok, stop: null }).ok).toBe(false);
    expect(sumarCriteria({ ...ok, return21dPct: null }).ok).toBe(false);
  });
  it("no si nunca se leyeron las noticias del símbolo", () => {
    const r = sumarCriteria({ ...ok, noticiasLeidas: false });
    expect(r.ok).toBe(false);
    expect(r.why).toContain("no leí las noticias");
  });
  it("con las noticias leídas, o sin saberlo, sigue valiendo como antes", () => {
    expect(sumarCriteria({ ...ok, noticiasLeidas: true }).ok).toBe(true);
    expect(sumarCriteria({ ...ok, noticiasLeidas: null }).ok).toBe(true);
  });
});

/**
 * GGAL, HUT, MARA, NEM e YPF el 12/9: cinco de las ocho posiciones con plata puesta y ni una noticia leída
 * jamás. El veredicto se calculaba con `events: []`, que es lo mismo que devuelve un símbolo verificado y
 * limpio, así que la app proponía SUMAR sin haber mirado nada.
 */
describe("una posición cuyas noticias nunca se leyeron", () => {
  it("no se propone para sumar, y el motivo lo dice", () => {
    const v = decideVerb({ ...base, candles: flat30, weightPct: 10, tesis: { news: { scannedTo: null } } });
    expect(v.verb).toBe("MANTENER");
    expect(v.warning).toContain("No leí las noticias");
  });
  it("pero tampoco pasa a REVISAR: no mirar no es lo mismo que encontrar algo malo", () => {
    const v = decideVerb({ ...base, candles: flat30, weightPct: 10, tesis: { news: { scannedTo: null } } });
    expect(v.tesisAlerts ?? []).toEqual([]);
  });
  it("leídas y sin eventos, vuelve a ser candidata a sumar y sin aviso", () => {
    const v = decideVerb({ ...base, candles: flat30, weightPct: 10, tesis: { news: { scannedTo: "2026-08-31" }, events: [] } });
    expect(v.verb).toBe("SUMAR");
    expect(v.warning).toBeNull();
  });
});

describe("applyDegrade", () => {
  const mantener = decideVerb({ ...base, candles: flat30 });
  it("MANTENER + degrade → REVISAR con el motivo y el stop nombrado", () => {
    const v = applyDegrade(mantener, { degrade: true, degradeReason: "guidance recortado en el 6-K" });
    expect(v.verb).toBe("REVISAR");
    expect(v.reason).toContain("guidance recortado");
    expect(v.reason).toContain("95");
  });
  it("sin degrade no cambia nada", () => expect(applyDegrade(mantener, { degrade: false })).toEqual(mantener));
  it("VENDER nunca cambia", () => {
    const c = [...flat30.slice(0, 29), { ...flat30[29]!, close: 94, low: 93 }];
    const vender = decideVerb({ ...base, candles: c });
    expect(applyDegrade(vender, { degrade: true, degradeReason: "x" }).verb).toBe("VENDER");
  });
  it("null (modelo falló) no cambia nada", () => expect(applyDegrade(mantener, null)).toEqual(mantener));
});
