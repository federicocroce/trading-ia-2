import { describe, expect, it } from "vitest";
import { AGENTE_REVISION_VERSION, AGENTE_VERSION, AgentReviewer, AgentVerifier, CUESTIONARIO_AGENTE, RevisionAgenteSchema, VerificacionAgenteSchema, dictamenDeRevision, dictamenDeVerificacion, type RevisionAgente, type VerificacionAgente } from "../src/index.js";

/*
 * 22/9: la verificación y la revisión pasan de Gemini gratis a un agente de Claude Code por cron. Gemini inventó datos
 * (SEZL "limpia 0,04 contra 0,09": el comunicado dice 1,13 contra 0,95), declaró "no cotiza" a AII, y tomó el comunicado
 * de un estudio de abogados como una investigación de SMCI. El agente devuelve HALLAZGOS con fuente; la app decide.
 */
const HOSTS = ["sec.gov", "prnewswire.com", "globenewswire.com", "businesswire.com"];
const sec = (titulo = "8-K") => ({ url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/ex99.htm", titulo });
const portal = { url: "https://www.marketbeat.com/stocks/NASDAQ/X/", titulo: "MarketBeat" };
const base = (over: Partial<VerificacionAgente> = {}): VerificacionAgente => ({
  symbol: "SEZL", fecha: "2026-09-22",
  ultimoTrimestre: { fechaReporte: "2026-08-06", ventasVsConsenso: "149,7 M contra 141 M", gananciaVsConsenso: "1,13 ajustada contra 0,95", extraordinarios: [], epsLimpia: 1.13, epsConsenso: 0.95, guia: "ingresos 2026 +35% (antes 30-35%)" },
  analistas: [], consensoObjetivo: null, eventos: [],
  valuacion: { texto: null, metric: null, current: null, min5y: null, max5y: null, growthAccelerating: null },
  proximosResultados: null, reservas: [], evitar: [], faltantes: [], fuentes: [sec()], resumen: "informe",
  ...over,
});

describe("dictamenDeVerificacion: la app decide con los hallazgos del agente", () => {
  it("SEZL 2T 2026: un extraordinario de 1,9 M con la ganancia limpia arriba del consenso no es reserva → apto", () => {
    const v = base({ ultimoTrimestre: { ...base().ultimoTrimestre!, extraordinarios: [{ detalle: "beneficio fiscal no recurrente", montoUsd: 1.9e6 }] }, reservas: [{ tipo: "extraordinarios", detalle: "beneficio fiscal no recurrente de 1,9 M", fuente: sec() }] });
    const r = dictamenDeVerificacion(v, HOSTS);
    expect(r.verdict).toBe("apto");
    expect(r.reason).toContain("1,13");
    expect(r.reason).toContain("0,95");
    expect(r.lastQuarter?.oneOffs).toEqual(["beneficio fiscal no recurrente (USD 1,9 M)"]);
    expect(r.model).toBe("claude (agente)");
  });
  it("BSM 15/9: la ganancia limpia queda debajo del consenso sin el ítem → la reserva vale", () => {
    const v = base({ symbol: "BSM", ultimoTrimestre: { ...base().ultimoTrimestre!, epsLimpia: 0.31, epsConsenso: 0.36 }, reservas: [{ tipo: "extraordinarios", detalle: "ganancia por venta de activos: sin ella 0,31 contra 0,36", fuente: sec() }] });
    expect(dictamenDeVerificacion(v, HOSTS)).toMatchObject({ verdict: "con_reservas", reason: "ganancia por venta de activos: sin ella 0,31 contra 0,36" });
  });
  it("extraordinarios sin los dos números: no es reserva, pero el código anota que falta la ganancia limpia y queda con reservas (falla cerrado)", () => {
    // Revisión del 22/9: si el agente se olvidaba de anotarlo en faltantes, la reserva caía y quedaba apto: el patrón de NBN.
    const sinNumeros = base({ ultimoTrimestre: { ...base().ultimoTrimestre!, epsLimpia: null }, reservas: [{ tipo: "extraordinarios", detalle: "hubo un ítem", fuente: sec() }] });
    const r = dictamenDeVerificacion(sinNumeros, HOSTS);
    expect(r.verdict).toBe("con_reservas");
    expect(r.reason).toMatch(/falta verificar: la ganancia limpia contra el consenso/);
    // Sin último trimestre, lo mismo.
    expect(dictamenDeVerificacion(base({ ultimoTrimestre: null }), HOSTS).verdict).toBe("con_reservas");
  });
  it("22/9, ensayo real: los faltantes que no son críticos (el rango de 5 años del P/E, un consenso que difiere entre fuentes) no bajan un apto", () => {
    const v = base({ faltantes: [{ dato: "otro", detalle: "mínimo y máximo de 5 años del P/E adelantado" }, { dato: "otro", detalle: "consenso de ventas exacto" }] });
    expect(dictamenDeVerificacion(v, HOSTS).verdict).toBe("apto");
    expect(dictamenDeVerificacion(base({ faltantes: [{ dato: "regulatorio", detalle: "estado de la licencia" }] }), HOSTS)).toMatchObject({ verdict: "con_reservas", reason: "falta verificar: estado de la licencia" });
  });
  it("22/9, ensayo real: una 'reserva' que es un dato que no encontró no es reserva", () => {
    const v = base({ reservas: [{ tipo: "dato_faltante", detalle: "No encontré el rango de 5 años del P/E", fuente: sec() }] });
    expect(dictamenDeVerificacion(v, HOSTS).verdict).toBe("apto");
  });
  it("ATEX 12/9: evitar por un ítem único con 8-K en sec.gov → evitar, con ese motivo", () => {
    const v = base({ symbol: "ATEX", evitar: [{ motivo: "item_unico", detalle: "la ganancia del trimestre es una ganancia contable por venta; sin ella pierde 12 M", fuente: sec() }] });
    expect(dictamenDeVerificacion(v, HOSTS)).toMatchObject({ verdict: "evitar", reason: "la ganancia del trimestre es una ganancia contable por venta; sin ella pierde 12 M" });
  });
  it("AII: un evitar sin fuente primaria baja a reserva; y un evitar que no encontró ni el trimestre pasa a con reservas", () => {
    const sinPrimaria = base({ symbol: "AII", evitar: [{ motivo: "catalizadores_consumidos", detalle: "el mercado ya descontó la temporada", fuente: portal }] });
    expect(dictamenDeVerificacion(sinPrimaria, HOSTS)).toMatchObject({ verdict: "con_reservas", reason: "el mercado ya descontó la temporada" });
    // Un evitar que depende del trimestre (ítem único, ingresos cayendo) sin haber encontrado el trimestre no vale.
    const ciego = base({ symbol: "AII", ultimoTrimestre: null, evitar: [{ motivo: "item_unico", detalle: "x", fuente: sec() }] });
    expect(dictamenDeVerificacion(ciego, HOSTS).verdict).toBe("con_reservas");
    // Revisión del 22/9: un evento binario con fuente del regulador sigue siendo evitar aunque no haya encontrado el trimestre.
    const fda = base({ symbol: "BIO", ultimoTrimestre: null, evitar: [{ motivo: "evento_binario", detalle: "decisión de la FDA el 2026-10-15", fuente: { url: "https://www.fda.gov/advisory-committees/x", titulo: "FDA" } }] });
    expect(dictamenDeVerificacion(fda, [...HOSTS, "fda.gov"]).verdict).toBe("evitar");
  });
  it("APH: valuación 29,5x en un rango de 22 a 32,5 no está en su máximo → apto, con los números", () => {
    const v = base({ symbol: "APH", valuacion: { texto: "P/E adelantado 29,5x", metric: "P/E adelantado", current: 29.5, min5y: 22, max5y: 32.5, growthAccelerating: true }, reservas: [{ tipo: "valuacion", detalle: "en el tercio superior de 5 años", fuente: sec() }] });
    const r = dictamenDeVerificacion(v, HOSTS);
    expect(r.verdict).toBe("apto");
    expect(r.reason).toContain("29,5");
  });
  it("22/9: un evitar o una reserva que sale del comunicado de un estudio de abogados (aunque venga por un cable) no cuenta", () => {
    const cable = { url: "https://www.globenewswire.com/news-release/2026/09/17/x/kuehn-law-encourages-investors.html", titulo: "Kuehn Law Encourages Investors of X" };
    const v = base({ evitar: [{ motivo: "evento_binario", detalle: "investigación a la empresa", fuente: cable }], reservas: [{ tipo: "demanda", detalle: "Kuehn Law encourages investors to contact the firm", fuente: cable }] });
    expect(dictamenDeVerificacion(v, HOSTS).verdict).toBe("apto");
  });
  it("sin reservas: apto con la guía en el motivo; y los campos van a la forma que guarda la app", () => {
    const r = dictamenDeVerificacion(base({ analistas: [{ fecha: "2026-09-10", firma: "UBS", accion: "sube objetivo", objetivo: 150 }], consensoObjetivo: 140, proximosResultados: "2026-11-05", valuacion: { texto: "22x adelantado", metric: null, current: null, min5y: null, max5y: null, growthAccelerating: null } }), HOSTS);
    expect(r).toMatchObject({ verdict: "apto", consensusTarget: 140, nextEarnings: "2026-11-05", valuation: "22x adelantado", analysts: [{ date: "2026-09-10", firm: "UBS", action: "sube objetivo", target: 150 }], sources: [{ title: "8-K", url: sec().url }], researchText: "informe" });
    expect(r.reason).toBe("sin reservas con fuente; guía: ingresos 2026 +35% (antes 30-35%)");
  });
});

describe("dictamenDeRevision", () => {
  const rev = (over: Partial<RevisionAgente> = {}): RevisionAgente => ({ symbol: "SMCI", fecha: "2026-09-22", busquedaHecha: true, motivoSinBusqueda: null, objeciones: [], fuentes: [], resumen: "r", ...over });
  it("SMCI 18/9: el comunicado de un estudio de abogados buscando demandantes no es una objeción", () => {
    const kuehn = { tipo: "regulacion" as const, detalle: "Kuehn Law encourages investors of Super Micro Computer to contact the firm", fecha: "2026-09-17", fuente: { url: "https://www.prnewswire.com/news-releases/kuehn-law-encourages-investors-of-super-micro-computer-inc-to-contact-law-firm-302882621.html", titulo: "Kuehn Law Encourages Investors" } };
    expect(dictamenDeRevision(rev({ objeciones: [kuehn] })).verdict).toBe("sin_objeciones");
  });
  it("SMCI: las investigaciones del DOJ, la SEC y la BIS que dice el 10-K sí son objeción", () => {
    const r = dictamenDeRevision(rev({ objeciones: [{ tipo: "regulacion", detalle: "el 10-K dice que DOJ, SEC y BIS siguen investigando el desvío de servidores a China", fecha: "2026-08-28", fuente: sec("10-K") }] }));
    expect(r).toMatchObject({ verdict: "objecion", reason: "el 10-K dice que DOJ, SEC y BIS siguen investigando el desvío de servidores a China (2026-08-28)" });
    expect(r.sources).toEqual([{ title: "10-K", url: sec().url }]);
  });
  it("sin objeciones → sin_objeciones; búsqueda no hecha → no_pude_verificar con el motivo", () => {
    expect(dictamenDeRevision(rev()).verdict).toBe("sin_objeciones");
    expect(dictamenDeRevision(rev({ busquedaHecha: false, motivoSinBusqueda: "límite de uso de la sesión" }))).toMatchObject({ verdict: "no_pude_verificar", reason: "límite de uso de la sesión" });
  });
});

describe("esquema, versión y verificador que no busca", () => {
  it("22/9, ensayo real: un texto más largo que el límite se recorta en vez de rechazar el ítem; valuación null y claves de más se toleran", () => {
    const largo = "x".repeat(500);
    const p = VerificacionAgenteSchema.safeParse({ ...base(), valuacion: null, extra: 1, reservas: [{ tipo: "insiders", detalle: largo, fuente: sec() }], analistas: [{ fecha: "2026-09-10", firma: "UBS", accion: largo, objetivo: null }] });
    expect(p.success).toBe(true);
    if (p.success) {
      expect(p.data.reservas[0]!.detalle).toHaveLength(200);
      expect(p.data.analistas[0]!.accion).toHaveLength(40);
      expect(p.data.valuacion).toEqual({ texto: null, metric: null, current: null, min5y: null, max5y: null, growthAccelerating: null });
    }
    expect(RevisionAgenteSchema.safeParse({ symbol: "X", fecha: "2026-09-22", busquedaHecha: true, motivoSinBusqueda: null, objeciones: [{ tipo: "capital", detalle: largo, fecha: "2026-09-01", fuente: sec() }], fuentes: [], resumen: "" }).success).toBe(true);
  });
  it("un hallazgo sin URL, una reserva de un tipo que no existe o un símbolo raro se rechazan", () => {
    expect(VerificacionAgenteSchema.safeParse(base()).success).toBe(true);
    expect(VerificacionAgenteSchema.safeParse(base({ reservas: [{ tipo: "valuacion", detalle: "x", fuente: { url: "", titulo: "x" } }] })).success).toBe(false);
    expect(VerificacionAgenteSchema.safeParse({ ...base(), reservas: [{ tipo: "humor", detalle: "x", fuente: sec() }] }).success).toBe(false);
    expect(VerificacionAgenteSchema.safeParse({ ...base(), symbol: "no es un símbolo" }).success).toBe(false);
    expect(VerificacionAgenteSchema.safeParse({ ...base(), fuentes: [] }).success).toBe(false);
    expect(RevisionAgenteSchema.safeParse({ symbol: "X", fecha: "2026-09-22", busquedaHecha: true, motivoSinBusqueda: null, objeciones: [{ tipo: "capital", detalle: "x", fecha: "2026-09-01", fuente: { url: "no-url", titulo: "x" } }], fuentes: [], resumen: "" }).success).toBe(false);
  });
  it("la versión sale del cuestionario: si cambia el cuestionario, cambia la versión", () => {
    expect(AGENTE_VERSION).toMatch(/^agente-v1-[0-9a-f]{12}$/);
    expect(AGENTE_REVISION_VERSION).toMatch(/^agente-r1-[0-9a-f]{12}$/);
    expect(CUESTIONARIO_AGENTE).toContain("NO escribas veredictos");
    expect(CUESTIONARIO_AGENTE).toContain("estudio de abogados");
    expect(CUESTIONARIO_AGENTE).toContain("no da guía");
  });
  it("el verificador y el revisor del agente no buscan: avisan que lo hace el agente", async () => {
    const v = new AgentVerifier();
    const r = new AgentReviewer();
    expect(v.porAgente).toBe(true);
    expect(v.promptVersion).toBe(AGENTE_VERSION);
    expect(r.promptVersion).toBe(AGENTE_REVISION_VERSION);
    await expect(v.verify({ symbol: "X", name: null, today: "2026-09-22" })).rejects.toThrow(/agente/);
    await expect(r.review({ symbol: "X", name: null, today: "2026-09-22", verification: null, line: { kind: "comprar", close: 1, stop: 1 } })).rejects.toThrow(/agente/);
  });
});
