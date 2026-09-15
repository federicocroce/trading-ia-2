import type { CandidateEvent, VerificationSummary } from "../radar/types.js";

/**
 * ¿Se rompió la tesis? (2026-09-12). Puro.
 *
 * Hasta hoy la app decidía vender y mantener solo por precio: el stop dinámico, la capa de la posición y
 * el peso en la cartera. Todo lo que sabe del negocio (la verificación web, los eventos materiales de las
 * noticias, las banderas de calidad de la ganancia de la SEC, el consenso de analistas) se usaba para
 * comprar y se tiraba al mantener. El resultado es que una posición se vendía porque el precio cayó, nunca
 * porque el negocio cambió, que es la razón por la que uno debería vender de verdad.
 *
 * Regla de diseño: **esto nunca vende solo.** El stop sigue siendo la única regla dura de salida. Lo que
 * hace acá es pasar a REVISAR y decir qué cambió, porque una tesis rota se evalúa, no se liquida por
 * reflejo. Es el mismo principio que ya regía para el modelo: solo puede degradar a REVISAR.
 */
export interface TesisInput {
  /** Verificación web del símbolo (spec 2026-09-10). */
  verification?: VerificationSummary | null;
  /** Eventos materiales de los últimos 90 días, ya clasificados. */
  events?: CandidateEvent[];
  /** Banderas de calidad de la ganancia desde la SEC (resultado extraordinario, minoritarios, cobranza lenta…). */
  qualityFlags?: string[];
  /** Recomendaciones de analistas del período más reciente. */
  analyst?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  /**
   * Hasta qué fecha se leyeron las noticias de este símbolo (`radar_news_scans`). Tres estados a propósito:
   * el campo ausente es "quien llama no sabe" (los tests viejos y cualquier uso sin barrido siguen igual),
   * `scannedTo: null` es **nunca se leyeron**, y una fecha es hasta cuándo.
   *
   * Existe porque el 12/9 la app mostraba "ningún evento detectado" en GGAL, HUT, MARA, NEM e YPF, cinco de
   * las ocho posiciones con plata, y en ninguna se había leído jamás una noticia. `events: []` significaba
   * las dos cosas y la pantalla elegía la optimista.
   */
  news?: { scannedTo: string | null };
}

/** ¿La app puede afirmar que no hubo eventos? Solo si efectivamente leyó las noticias. */
export function noticiasLeidas(i: TesisInput): boolean | null {
  if (i.news === undefined) return null;
  return i.news.scannedTo !== null;
}

/** A partir de cuántas salvedades de calidad se pide revisar. Igual que para comprar: dos. */
export const TESIS_QUALITY_AT = 2;
/** Proporción de vender/vender fuerte a partir de la cual el consenso dejó de acompañar. */
export const TESIS_SELL_CONSENSUS = 0.4;

export interface TesisAlert {
  /** Nombre corto y estable del motivo. */
  kind: string;
  /** Qué cambió, en una frase que se pueda leer en la ficha. */
  detail: string;
}

/** Sin el punto final: la frase se arma con otras y terminaba en "inciertas.. Revisá si" (Hoy, 15/9). */
const sinPunto = (s: string) => s.trim().replace(/[.\s]+$/, "");

export function tesisAlerts(i: TesisInput): TesisAlert[] {
  const out: TesisAlert[] = [];

  if (i.verification?.verdict === "evitar") {
    out.push({ kind: "verificacion_evitar", detail: `la verificación web del ${i.verification.date} dice evitar: ${sinPunto(i.verification.reason)}` });
  } else if (i.verification?.verdict === "con_reservas") {
    out.push({ kind: "verificacion_reservas", detail: `la verificación web del ${i.verification.date} tiene reservas: ${sinPunto(i.verification.reason)}` });
  }

  const grave = (i.events ?? []).find((e) => e.severity === "grave");
  if (grave) out.push({ kind: "evento_grave", detail: `evento grave del ${grave.date} (${grave.kind}): ${sinPunto(grave.headline)}` });

  const salvedades = (i.qualityFlags ?? []).length;
  if (salvedades >= TESIS_QUALITY_AT) {
    out.push({ kind: "salvedades_de_calidad", detail: `${salvedades} salvedades en la calidad de la ganancia: ${(i.qualityFlags ?? []).join(", ")}` });
  }

  const a = i.analyst;
  if (a) {
    const total = a.strongBuy + a.buy + a.hold + a.sell + a.strongSell;
    if (total > 0 && (a.sell + a.strongSell) / total > TESIS_SELL_CONSENSUS) {
      out.push({ kind: "consenso_venta", detail: `${a.sell + a.strongSell} de ${total} analistas recomiendan vender` });
    }
  }

  return out;
}
