import { z } from "zod";

/**
 * Hechos externos (17/9). Datos con fecha y fuente que la app no puede sacar de sus proveedores, en una forma que las
 * reglas puedan leer. Los carga un agente (o el dueño, a mano) por el importador; la app decide con reglas y tests.
 *
 * La regla que manda: el agente escribe HECHOS, no veredictos. "FIVE: guía anual subida el 2/9 de 8,65-9,05 a
 * 9,83-10,31, fuente 8-K en sec.gov" sí; "FIVE: COMPRAR" no, porque serían dos varas.
 *
 * Y sólo lo VERIFICADO mueve algo. Verificado = la fuente es primaria (un host de la lista de config: reguladores y
 * cables de comunicados). Lo demás se muestra con su estado y no cambia banderas, veredictos ni convicción (13/9: un
 * dato inventado dentro de un recordatorio no puede mover un plan).
 */
export const HECHO_TIPOS = ["guia", "ganancia_por_reservas", "oferta_de_compra"] as const;
export type HechoTipo = (typeof HECHO_TIPOS)[number];

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const simbolo = z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,9}$/);
export const FuenteSchema = z.object({ url: z.string().url(), titulo: z.string().min(1) });
export const GuiaValorSchema = z.object({ direccion: z.enum(["sube", "baja", "reafirma"]), metrica: z.string().min(1), periodo: z.string().min(1), antes: z.string().nullable(), despues: z.string().nullable() });
export const ReservasValorSchema = z.object({ trimestre: z.string().min(1), montoUsd: z.number(), puntosCombinado: z.number().nullable(), epsPublicado: z.number(), epsSinReservas: z.number(), epsConsenso: z.number().nullable() });
export const OfertaValorSchema = z.object({ comprador: z.string().min(1), efectivoUsd: z.number().nullable(), ratio: z.object({ acciones: z.number().positive(), de: z.string().min(1) }).nullable(), etapa: z.string().min(1), cierreEsperado: z.string().nullable(), formulario: z.string().nullable() });

const comun = { symbol: simbolo, fecha: fechaIso, fuente: FuenteSchema };
export const HechoEntradaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("guia"), ...comun, valor: GuiaValorSchema }),
  z.object({ tipo: z.literal("ganancia_por_reservas"), ...comun, valor: ReservasValorSchema }),
  z.object({ tipo: z.literal("oferta_de_compra"), ...comun, valor: OfertaValorSchema }),
]);
export type HechoEntrada = z.infer<typeof HechoEntradaSchema>;
export type HechoExterno = HechoEntrada & { primaria: boolean; estado: "verificado" | "no_verificado"; origen: "agente" | "manual"; detectadoAt: string; vigenteHasta: string | null };

/** Cuánto dura cada tipo de hecho. Una oferta firmada hace meses sigue fijando el precio (AES: 400 días, como EDGAR). */
export const VENTANAS_DIAS: Record<HechoTipo, number> = { guia: 90, ganancia_por_reservas: 120, oferta_de_compra: 400 };
export const VENTANA_MAXIMA_DIAS = 400;
/** La puerta de entrada al ranking: como mucho estos símbolos, los más recientes. */
export const PUERTA_TOPE = 20;
const DAY = 86_400_000;

export function esFuentePrimaria(url: string, hosts: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
}

export function clasificarHecho(e: HechoEntrada, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string }): HechoExterno {
  const primaria = esFuentePrimaria(e.fuente.url, o.hostsPrimarios);
  return { ...e, symbol: e.symbol.toUpperCase(), primaria, estado: primaria ? "verificado" : "no_verificado", origen: o.origen, detectadoAt: o.detectadoAt, vigenteHasta: null };
}

/** Dentro de la ventana de su tipo y no vencido. Independiente del estado: lo no verificado también se muestra. */
export function hechosVigentes(hechos: readonly HechoExterno[], today: string): HechoExterno[] {
  const hoy = Date.parse(today);
  return hechos.filter((h) => {
    if (h.vigenteHasta !== null && h.vigenteHasta < today) return false;
    const edad = (hoy - Date.parse(h.fecha)) / DAY;
    return edad >= 0 && edad <= VENTANAS_DIAS[h.tipo];
  });
}

const coma = (n: number) => String(n).replace(".", ",");
const millones = (usd: number) => `USD ${Math.round(usd / 1e6)} M`;

/** El texto de la salvedad o la razón, para la ficha y para el informe. */
export function textoDeHecho(h: HechoExterno): string {
  if (h.tipo === "guia") {
    const verbo = h.valor.direccion === "sube" ? "subió" : h.valor.direccion === "baja" ? "recortó" : "reafirmó";
    return `${verbo} la guía el ${h.fecha}: ${h.valor.metrica} ${h.valor.antes ?? "—"} → ${h.valor.despues ?? "—"}`;
  }
  if (h.tipo === "ganancia_por_reservas") {
    return `la ganancia del ${h.valor.trimestre} lleva ${millones(h.valor.montoUsd)} de reservas liberadas: sin eso ${coma(h.valor.epsSinReservas)} contra ${h.valor.epsConsenso === null ? "—" : coma(h.valor.epsConsenso)} esperado`;
  }
  const v = h.valor;
  if (v.ratio) return `vale ${coma(v.ratio.acciones)} acciones de ${v.ratio.de} (${v.comprador}, ${v.etapa})`;
  return `vendida a ${v.efectivoUsd === null ? "—" : coma(v.efectivoUsd)} en efectivo (${v.comprador}, ${v.etapa})`;
}

/**
 * Banderas que producen los hechos VERIFICADOS y vigentes. Los pesos los pone `conviction.ts` y copian a los datos
 * equivalentes del proveedor: `guia_subida` vale lo que `sorpresa_positiva`, `ganancia_por_reservas` lo que
 * `sorpresa_negativa`. `bajo_oferta_de_compra` es la misma bandera que producen los formularios de EDGAR.
 */
export function banderasDeHechos(hechos: readonly HechoExterno[], today: string): string[] {
  const out: string[] = [];
  const add = (f: string) => { if (!out.includes(f)) out.push(f); };
  for (const h of hechosVigentes(hechos, today)) {
    if (h.estado !== "verificado") continue;
    if (h.tipo === "guia") add(h.valor.direccion === "sube" ? "guia_subida" : h.valor.direccion === "baja" ? "guia_recortada" : "guia_reafirmada");
    else if (h.tipo === "ganancia_por_reservas") {
      const sobrevive = h.valor.epsConsenso !== null && h.valor.epsSinReservas >= h.valor.epsConsenso;
      if (!sobrevive) add("ganancia_por_reservas");
    } else if (h.tipo === "oferta_de_compra") add("bajo_oferta_de_compra");
  }
  return out;
}

/**
 * La puerta de entrada (17/9): un hecho verificado de guía subida garantiza que la app mire a esa empresa aunque su
 * puntaje la deje fuera de la preselección. No cambia el puntaje ni el filtro. FIVE en el puesto 412 con la guía
 * subida dos veces es el caso.
 */
export function simbolosConPuerta(hechos: readonly HechoExterno[], today: string, tope = PUERTA_TOPE): string[] {
  const out: string[] = [];
  const candidatos = hechosVigentes(hechos, today)
    .filter((h) => h.estado === "verificado" && h.tipo === "guia" && h.valor.direccion === "sube")
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const h of candidatos) {
    if (out.length >= tope) break;
    if (!out.includes(h.symbol)) out.push(h.symbol);
  }
  return out;
}
