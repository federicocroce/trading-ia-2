import { describe, expect, it } from "vitest";
import { medirRegistro, rachasDeVenta } from "./registro.js";

// Precios de prueba: SPY sube 2%; GGAL cae 8% desde su VENDER; AMAT sube 5% desde que entró al plan.
const precios: Record<string, Record<string, number>> = {
  SPY: { "2026-09-24": 100, "2026-10-01": 100, "2026-10-09": 102 },
  GGAL: { "2026-09-24": 40, "2026-10-09": 36.8 },
  AMAT: { "2026-10-01": 500, "2026-10-09": 525 },
  TSEM: { "2026-10-01": 230, "2026-10-09": 240 },
};
const precioEn = (s: string, f: string) => { const p = precios[s]; if (!p) return null; const ks = Object.keys(p).filter((k) => k <= f).sort(); return ks.length ? p[ks.at(-1)!]! : null; };
const ultimo = (s: string) => { const p = precios[s]; if (!p) return null; const k = Object.keys(p).sort().at(-1)!; return { fecha: k, close: p[k]! }; };

describe("medirRegistro (10/10)", () => {
  it("una compra acierta si le gana al S&P; una venta o un veto aciertan si rinden menos", () => {
    const { filas, resumen } = medirRegistro([
      { tipo: "compra_plan", symbol: "AMAT", desde: "2026-10-01" },
      { tipo: "venta_cartera", symbol: "GGAL", desde: "2026-09-24" },
      { tipo: "veto_analista", symbol: "TSEM", desde: "2026-10-01" },
    ], precioEn, ultimo);
    expect(filas.find((f) => f.symbol === "AMAT")).toMatchObject({ retornoPct: 5, spyPct: 2, alfaPct: 3, acerto: true });
    expect(filas.find((f) => f.symbol === "GGAL")).toMatchObject({ retornoPct: -8, alfaPct: -10, acerto: true });
    expect(filas.find((f) => f.symbol === "TSEM")!.acerto).toBe(false); // subió más que el S&P: el veto se equivocó
    expect(resumen.find((r) => r.tipo === "veto_analista")).toMatchObject({ senales: 1, medidas: 1, aciertoPct: 0 });
  });
  it("una señal de hoy todavía no se mide: no se inventa un resultado", () => {
    const { filas } = medirRegistro([{ tipo: "compra_plan", symbol: "AMAT", desde: "2026-10-09" }], precioEn, ultimo);
    expect(filas[0]).toMatchObject({ retornoPct: null, acerto: null });
  });
});

describe("rachasDeVenta", () => {
  it("una señal por racha de VENDER, no una por día; si vuelve a VENDER después de otra cosa, es otra señal", () => {
    const r = rachasDeVenta([
      { symbol: "GGAL", verdictDate: "2026-09-24", verb: "VENDER" }, { symbol: "GGAL", verdictDate: "2026-09-25", verb: "VENDER" },
      { symbol: "HUT", verdictDate: "2026-10-01", verb: "VENDER" }, { symbol: "HUT", verdictDate: "2026-10-05", verb: "REVISAR" }, { symbol: "HUT", verdictDate: "2026-10-09", verb: "VENDER" },
    ]);
    expect(r.map((x) => `${x.symbol}:${x.desde}`).sort()).toEqual(["GGAL:2026-09-24", "HUT:2026-10-01", "HUT:2026-10-09"]);
  });
});
