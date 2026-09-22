import { createHash } from "node:crypto";
import { z } from "zod";
import { esFuentePrimaria, type CandidateVerifier, type PreTradeReviewInput, type PreTradeReviewResult, type PreTradeReviewer, type VerifierInput, type VerifierResult } from "@thesis/core";
import { RESERVA_TIPOS, VERDICTS, aplicarExtraordinarios, aplicarFaltantes, aplicarValuacion, type Reserva } from "./verifier.js";

/**
 * La verificación y la revisión las hace un agente de Claude Code por cron (22/9, spec 2026-09-22-verificacion-por-agente).
 * Con Gemini gratis las cuatro claves se agotaban y, cuando respondía, inventaba datos: SEZL "limpia 0,04 contra 0,09"
 * (el comunicado dice 1,13 contra 0,95), AII "no es una empresa cotizada", y el comunicado de un estudio de abogados
 * tomado como investigación de SMCI. El agente lee los documentos y devuelve HALLAZGOS con fuente; esta regla decide.
 */
export const EVITAR_MOTIVOS = ["item_unico", "ingresos_cayendo_sin_guia", "evento_binario", "precio_sobre_consenso_tras_suba", "catalizadores_consumidos"] as const;
export const OBJECION_TIPOS = ["resultados", "regulacion", "capital", "analistas", "noticias"] as const;
/**
 * Qué dato faltó. Solo los críticos (todos menos `otro`) bajan un apto: en el ensayo del 22/9 los agentes anotaban como
 * faltante el rango de 5 años del P/E o un consenso que difería entre fuentes, y con eso todo quedaba "con reservas".
 * Son los datos críticos del criterio escrito desde el 15/9.
 */
export const FALTANTE_DATOS = ["ganancia_limpia", "extraordinarios", "guia", "regulatorio", "ofertas_de_acciones", "banco_inmobiliario", "otro"] as const;

export const CUESTIONARIO_VERIFICACION_AGENTE = `VERIFICACIÓN. Para cada símbolo, leé el ÚLTIMO comunicado de resultados trimestrales (8-K con exhibit 99 o 6-K en sec.gov, o el comunicado en prnewswire/globenewswire/businesswire), el último 10-Q o 10-K y los Form 4 de los últimos 90 días. Respondé en JSON, sin prosa alrededor, un objeto por símbolo con esta forma exacta:
{ "symbol", "fecha": hoy AAAA-MM-DD,
  "ultimoTrimestre": { "fechaReporte", "ventasVsConsenso", "gananciaVsConsenso", "extraordinarios": [{ "detalle", "montoUsd" }], "epsLimpia": número (ganancia por acción SIN los ítems no recurrentes, sacada del comunicado), "epsConsenso": número, "guia": texto (dada, subida, bajada o retirada, con cifras) } o null si no lo encontraste,
  "analistas": [{ "fecha", "firma", "accion", "objetivo" }] (últimos 90 días), "consensoObjetivo": número o null,
  "eventos": [{ "fecha", "tipo", "titular" }] (últimos 90 días: regulatorios, licencias, litigios, ofertas de acciones, cambios de CEO/CFO, informes de vendedores en corto, ciberataques, adquisiciones grandes),
  "valuacion": { "texto", "metric" (el múltiplo contra su historia: P/E adelantado; en bancos precio/valor libro tangible), "current", "min5y", "max5y" (números; un promedio o una mediana NO son mínimo ni máximo), "growthAccelerating" (true/false/null) },
  "proximosResultados": fecha o null,
  "reservas": [{ "tipo": uno de ${RESERVA_TIPOS.join(", ")}, "detalle": una oración con el dato, "fuente": { "url", "titulo" } }],
  "evitar": [{ "motivo": uno de ${EVITAR_MOTIVOS.join(", ")}, "detalle", "fuente": { "url", "titulo" } }],
  "faltantes": [{ "dato": uno de ${FALTANTE_DATOS.join(", ")}, "detalle" }] (lo que buscaste y no encontraste; los críticos son la ganancia limpia y su consenso, los ítems no recurrentes, la guía, los riesgos regulatorios o de licencias, las ofertas de acciones de 90 días y, en bancos, el inmobiliario comercial sobre capital; cualquier otro dato es "otro"),
  "fuentes": [{ "url", "titulo" }] (todas las que usaste, al menos una),
  "resumen": el informe en texto, en español, con fechas }
Textos cortos: una oración, hasta 200 caracteres (lo más largo se recorta). Si la empresa no da guía, escribí "guia": "no da guía" (no es un faltante). Un dato que no encontraste NO es una reserva: va a "faltantes".
Qué es cada cosa. RESERVA: una salvedad seria con su dato y su fuente (extraordinarios con su monto; valuación con los tres números; banco con inmobiliario comercial arriba de 300% del capital y fondeo mayorista creciendo; pico de ciclo; guía que no sube con precios presionados; insiders vendiendo fuerte acciones que YA tenían —ejercer opciones y vender el mismo día no es reserva—; un solo analista; adquisición apalancada pendiente; demanda de accionistas con moción pendiente). EVITAR: la ganancia se explica por un ítem único y sin él pierde o apenas gana (item_unico); ingresos cayendo y guía sin sostén; evento binario en menos de 6 semanas (decisión regulatoria, panel, juicio); precio en o sobre el objetivo de consenso tras subir más de 50% en 12 meses; catalizadores ya consumidos con núcleo débil.`;

export const CUESTIONARIO_REVISION_AGENTE = `REVISIÓN ANTES DE COMPRAR. Para cada símbolo de "revisar", buscá lo publicado en los últimos 30 días y lo que vence en los próximos 6 meses que cambie la compra de hoy: resultados (ganancia por ítems únicos, guía recortada o retirada), regulación (licencias o permisos que vencen, investigaciones de un organismo, sanciones, litigios materiales con fecha), capital (ofertas de acciones o convertibles, ventas grandes del accionista de control, rating de deuda), analistas (rebajas de los últimos 30 días), noticias de los últimos 7 días. Respondé en JSON, un objeto por símbolo:
{ "symbol", "fecha": hoy, "busquedaHecha": true/false, "motivoSinBusqueda": texto o null, "objeciones": [{ "tipo": uno de ${OBJECION_TIPOS.join(", ")}, "detalle", "fecha", "fuente": { "url", "titulo" } }], "fuentes": [...], "resumen" }
El comunicado de un estudio de abogados buscando accionistas demandantes ("encourages investors", "investigation on behalf of") NO es una objeción: no lo escribas. Una noticia vieja ya conocida o una opinión sin datos tampoco.`;

export const CUESTIONARIO_AGENTE = `Reglas: escribís HALLAZGOS con dato, fecha y URL. NO escribas veredictos ("apto", "comprar", "evitar" como conclusión): los decide la app con tus hallazgos. Sin URL no se escribe. Lo que no encontraste va a "faltantes", nunca se inventa un número.

${CUESTIONARIO_VERIFICACION_AGENTE}

${CUESTIONARIO_REVISION_AGENTE}`;

const h12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** Si cambia el cuestionario, cambia la versión: lo verificado antes queda "cuestionario anterior" (aviso) y se rehace. */
export const AGENTE_VERSION = `agente-v1-${h12(CUESTIONARIO_VERIFICACION_AGENTE)}`;
export const AGENTE_REVISION_VERSION = `agente-r1-${h12(CUESTIONARIO_REVISION_AGENTE)}`;

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const simbolo = z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,9}$/, "símbolo");
/** Un texto más largo que el límite se recorta: en el ensayo del 22/9 los agentes escribían de más y se rechazaba todo. */
const texto = (max: number) => z.string().min(1).transform((x) => x.trim().slice(0, max));
const Fuente = z.object({ url: z.string().url(), titulo: texto(200) });
const VALUACION_VACIA = { texto: null, metric: null, current: null, min5y: null, max5y: null, growthAccelerating: null };

export const VerificacionAgenteSchema = z
  .object({
    symbol: simbolo,
    fecha: fechaIso,
    ultimoTrimestre: z
      .object({
        fechaReporte: fechaIso.nullable(),
        ventasVsConsenso: texto(200).nullable(),
        gananciaVsConsenso: texto(200).nullable(),
        extraordinarios: z.array(z.object({ detalle: texto(200), montoUsd: z.number().nullable() })).max(12),
        epsLimpia: z.number().nullable(),
        epsConsenso: z.number().nullable(),
        guia: texto(300).nullable(),
      })
      .nullable(),
    analistas: z.array(z.object({ fecha: fechaIso, firma: texto(80), accion: texto(40), objetivo: z.number().nullable() })).max(40),
    consensoObjetivo: z.number().nullable(),
    eventos: z.array(z.object({ fecha: fechaIso, tipo: texto(40), titular: texto(300) })).max(40),
    valuacion: z.object({ texto: texto(300).nullable(), metric: texto(60).nullable(), current: z.number().nullable(), min5y: z.number().nullable(), max5y: z.number().nullable(), growthAccelerating: z.boolean().nullable() }).nullable().transform((v) => v ?? VALUACION_VACIA),
    proximosResultados: fechaIso.nullable(),
    reservas: z.array(z.object({ tipo: z.enum(RESERVA_TIPOS), detalle: texto(200), fuente: Fuente })).max(12),
    evitar: z.array(z.object({ motivo: z.enum(EVITAR_MOTIVOS), detalle: texto(200), fuente: Fuente })).max(6),
    faltantes: z.array(z.object({ dato: z.enum(FALTANTE_DATOS), detalle: texto(200) })).transform((xs) => xs.slice(0, 12)),
    fuentes: z.array(Fuente).min(1).max(40),
    resumen: texto(8000),
  });
export type VerificacionAgente = z.infer<typeof VerificacionAgenteSchema>;

export const RevisionAgenteSchema = z
  .object({
    symbol: simbolo,
    fecha: fechaIso,
    busquedaHecha: z.boolean(),
    motivoSinBusqueda: texto(300).nullable(),
    objeciones: z.array(z.object({ tipo: z.enum(OBJECION_TIPOS), detalle: texto(300), fecha: fechaIso, fuente: Fuente })).max(12),
    fuentes: z.array(Fuente).max(40),
    resumen: z.string().max(6000),
  });
export type RevisionAgente = z.infer<typeof RevisionAgenteSchema>;

const MODELO = "claude (agente)";
const coma = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const millones = (usd: number) => `USD ${coma(usd / 1e6)} M`;

/**
 * Hallazgos → dictamen. Evitar solo con fuente primaria (es lo único de la IA que todavía frena una compra); un motivo de
 * evitar sin fuente primaria baja a reserva. Después las reglas del criterio escrito: extraordinarios y valuación. Al final
 * `aplicarFaltantes`: un apto con datos críticos sin encontrar vuelve a con reservas, y un evitar que no encontró ni el
 * trimestre también.
 */
export function dictamenDeVerificacion(v: VerificacionAgente, hostsPrimarios: readonly string[]): VerifierResult {
  const deAbogados = (f: { detalle: string; fuente: { url: string; titulo: string } }) => ESTUDIO_DE_ABOGADOS.test(`${f.detalle} ${f.fuente.titulo} ${f.fuente.url}`);
  const q = v.ultimoTrimestre;
  // Evitar: con fuente primaria, que no sea un estudio de abogados, y si depende del trimestre, con el trimestre encontrado.
  const dependeDelTrimestre = (m: string) => m === "item_unico" || m === "ingresos_cayendo_sin_guia";
  const evitarValido = v.evitar.filter((e) => !deAbogados(e) && esFuentePrimaria(e.fuente.url, hostsPrimarios) && !(q === null && dependeDelTrimestre(e.motivo)));
  const bajanAReserva: Reserva[] = v.evitar.filter((e) => !evitarValido.includes(e) && !deAbogados(e)).map((e) => ({ tipo: "otra", detalle: e.detalle }));
  // Un dato que no encontró no es una reserva (ensayo del 22/9): va por faltantes.
  const reservas: Reserva[] = [...v.reservas.filter((r) => r.tipo !== "dato_faltante" && !deAbogados(r)).map((r) => ({ tipo: r.tipo, detalle: r.detalle })), ...bajanAReserva];
  // Faltantes críticos. La ganancia limpia contra el consenso la exige el código aunque el agente no la anote (falla cerrado).
  const criticos = v.faltantes.filter((f) => f.dato !== "otro").map((f) => f.detalle);
  if ((q === null || q.epsLimpia === null || q.epsConsenso === null) && !v.faltantes.some((f) => f.dato === "ganancia_limpia")) criticos.unshift("la ganancia limpia contra el consenso");
  const sinReservas = `sin reservas con fuente${q?.guia ? `; guía: ${q.guia}` : ""}`.slice(0, 300);
  let final: { verdict: (typeof VERDICTS)[number]; reason: string };
  if (evitarValido.length) {
    final = { verdict: "evitar", reason: evitarValido[0]!.detalle };
  } else {
    const inicial = { verdict: reservas.length ? ("con_reservas" as const) : ("apto" as const), reason: reservas[0]?.detalle ?? sinReservas, reservas };
    const tras = aplicarValuacion({ ...aplicarExtraordinarios(inicial, { limpia: q?.epsLimpia ?? null, consenso: q?.epsConsenso ?? null }), valuationNumbers: v.valuacion });
    final = aplicarFaltantes({ verdict: tras.verdict, reason: tras.reason }, criticos);
  }
  return {
    verdict: final.verdict,
    reason: final.reason.slice(0, 300),
    lastQuarter: q ? { reportDate: q.fechaReporte, revenueVsConsensus: q.ventasVsConsenso, epsVsConsensus: q.gananciaVsConsenso, oneOffs: q.extraordinarios.map((x) => (x.montoUsd === null ? x.detalle : `${x.detalle} (${millones(x.montoUsd)})`)), guidance: q.guia } : null,
    analysts: v.analistas.map((a) => ({ date: a.fecha, firm: a.firma, action: a.accion, target: a.objetivo })),
    consensusTarget: v.consensoObjetivo,
    events: v.eventos.map((e) => ({ date: e.fecha, kind: e.tipo, headline: e.titular })),
    valuation: v.valuacion.texto,
    nextEarnings: v.proximosResultados,
    sources: v.fuentes.map((f) => ({ title: f.titulo, url: f.url })),
    researchText: v.resumen,
    model: MODELO,
  };
}

/** El comunicado de un estudio de abogados buscando demandantes no es un hecho (SMCI, Kuehn Law, 17/9). */
export const ESTUDIO_DE_ABOGADOS = /law firm|estudio de abogados|encourages .{0,40}investors|investigation on behalf of|on behalf of (?:investors|shareholders)|class action (?:lawsuit )?(?:filed|reminder|deadline)|shareholder rights|investors (?:who|that) (?:purchased|lost)/i;

export function dictamenDeRevision(r: RevisionAgente): PreTradeReviewResult {
  const objeciones = r.objeciones.filter((o) => !ESTUDIO_DE_ABOGADOS.test(`${o.detalle} ${o.fuente.titulo} ${o.fuente.url}`));
  const vistas = new Set<string>();
  const sources = [...objeciones.map((o) => o.fuente), ...r.fuentes].filter((f) => (vistas.has(f.url) ? false : (vistas.add(f.url), true))).map((f) => ({ title: f.titulo, url: f.url }));
  const base = { sources, researchText: r.resumen, model: MODELO };
  if (!r.busquedaHecha) return { ...base, verdict: "no_pude_verificar", reason: (r.motivoSinBusqueda ?? "la búsqueda no se pudo hacer").slice(0, 300) };
  if (objeciones.length) return { ...base, verdict: "objecion", reason: `${objeciones[0]!.detalle} (${objeciones[0]!.fecha})`.slice(0, 300) };
  return { ...base, verdict: "sin_objeciones", reason: "sin objeciones con fuente en los últimos 30 días" };
}

const LO_HACE_EL_AGENTE = "la verificación la hace el agente de Claude por cron (radar-cli verificar --importar): la app no busca";

/** Verificador que no busca: da la versión del agente y la app lee lo que el agente guardó. */
export class AgentVerifier implements CandidateVerifier {
  readonly promptVersion = AGENTE_VERSION;
  readonly porAgente = true;
  async verify(_input: VerifierInput): Promise<VerifierResult> {
    throw new Error(LO_HACE_EL_AGENTE);
  }
}
/** Revisor que no busca: la revisión la escribe el agente. */
export class AgentReviewer implements PreTradeReviewer {
  readonly promptVersion = AGENTE_REVISION_VERSION;
  readonly porAgente = true;
  async review(_input: PreTradeReviewInput): Promise<PreTradeReviewResult> {
    throw new Error(LO_HACE_EL_AGENTE);
  }
}
