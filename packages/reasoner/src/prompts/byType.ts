import type { EventType } from "@thesis/core";

/** Guía específica por tipo de evento. Se agrega al user message. */
export const TYPE_GUIDANCE: Record<EventType, string> = {
  earnings: `Evento: reporte trimestral con fecha.
Analizá: guidance previo vs consenso, tendencia de márgenes y caja en los últimos 10-Q, cambios en 8-K recientes (contratos, despidos, financiamiento), lenguaje del management, y cómo reaccionó el precio en reportes anteriores (comparables). El move implícito te dice cuánto ya descuenta el mercado; tu edge tiene que venir de algo que el consenso no está mirando.`,
  fda: `Evento: decisión regulatoria con fecha (PDUFA, AdCom, CRL).
Analizá: datos de fase 3 (endpoints primarios, significancia, seguridad), precedentes de la misma división de FDA, si hubo AdCom y su voto, historial de CRLs de la empresa, caja disponible (¿sobrevive a un rechazo?). Para eventos binarios, el instrumento suele ser opción y pMarket viene del precio del straddle.`,
  legal: `Evento: fallo, sentencia o decisión antimonopolio con fecha.
Analizá: el expediente (argumentos, precedentes del mismo tribunal/juez), señales en audiencias, magnitud económica del resultado vs capitalización, y cuánto ya movió el precio desde que se conoció el caso.`,
  macro_ar: `Evento: hecho político/regulatorio argentino con fecha que afecta a ADRs (licitaciones, decretos, datos INDEC/BCRA, fallos, elecciones).
Analizá: qué empresas del portfolio quedan expuestas y en qué dirección, precedentes de reacciones de ADRs a eventos similares, riesgo cambiario y de cepo, y si el mercado ya lo descontó (riesgo país, precio de bonos). El ticker "ARG" es sintético: proponé la tesis sobre un ADR concreto.`,
  operational: `Señal operativa sin fecha (filing, contratación, patente, noticia de empresa).
Analizá si la señal implica un cambio real en ingresos/costos/riesgo que el mercado no valoró todavía. Como no hay fecha, el catalizador es el próximo reporte trimestral: usá esa fecha como horizonte y sé más exigente con la evidencia.`,
};
