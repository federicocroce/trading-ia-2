import type { Overlap } from "./overlap.js";
import { isRateSensitive, type MacroRegime } from "./regime.js";
import type { CandidateRow, Tags } from "./types.js";

/**
 * Convicción: junta en un número, y en palabras, todos los factores que el Radar ya calculó
 * para un candidato COMPRAR. No predice nada nuevo: ordena lo que hay y dice qué acompaña y qué no.
 *
 *   convicción = score × fiabilidad(grupo) + banderas − exceso de riesgo − objetivo cercano − tema cargado
 *
 * - fiabilidad: min(1, pares / 10). Ser 1° de 5 vale la mitad que ser 1° de 10 o más.
 * - banderas: +0.2 consenso de compra / insiders compran / sorpresa positiva;
 *             −0.15 insiders venden (suele ser rutina); −0.3 sorpresa negativa / consenso de venta;
 *             −0.3 evento moderado reciente (se cita fecha y titular); −0.3 hay titulares sin clasificar;
 *             −0.3 cada salvedad de calidad de la ganancia (socios minoritarios, cobranza lenta, ganancia sin ventas);
 *             −0.3 verificación web con reservas (se cita el motivo); apta suma a las razones sin bonificar;
 *             −0.3 consenso a menos de 10% del precio; −0.3 subió más de 100% en 12 meses;
 *             −0.3 sensible a tasas (REIT, servicios públicos, minera de oro) con régimen restrictivo.
 * - riesgo: −0.1 por cada punto por encima de 5.
 * - objetivo: −0.3 si queda a menos de 5% (el objetivo es 2× la distancia al stop, no un pronóstico).
 * - tema cargado: −0.3 si comparte un tema donde la cartera ya supera el umbral de concentración.
 * - se mueve como lo tuyo: −0.3 si sus retornos correlacionan > 0.7 con una posición (mismo riesgo con otro nombre).
 * - salvedades sin penalización: resultado_extraordinario (la ganancia núcleo ya lo corrige) y
 *   sin_estados (métricas de Finnhub, sin estados de la SEC) solo avisan.
 */
export interface TopPick {
  symbol: string;
  conviction: number;
  /** % desde el precio hasta el objetivo (positivo) y hasta el stop (negativo). */
  gainPct: number;
  lossPct: number;
  reasons: string[];
  cautions: string[];
  /** Sin salvedades: todos los factores acompañan. */
  allAligned: boolean;
}

const POSITIVE: Record<string, string> = {
  consenso_compra: "analistas: consenso de compra",
  insiders_compran: "insiders compraron en los últimos 90 días",
  sorpresa_positiva: "último resultado sorprendió para arriba",
};
const NEGATIVE: Record<string, { text: string; penalty: number }> = {
  insiders_venden: { text: "insiders vendieron en los últimos 90 días", penalty: 0.15 },
  sorpresa_negativa: { text: "último resultado decepcionó", penalty: 0.3 },
  consenso_venta: { text: "analistas: consenso de venta", penalty: 0.3 },
  evento_moderado: { text: "evento moderado reciente", penalty: 0.3 },
  eventos_sin_clasificar: { text: "hay titulares materiales sin clasificar (cuota del modelo): revisá la ficha", penalty: 0.3 },
  interes_minoritario: { text: "los socios minoritarios se llevan una parte grande de la ganancia: el EPS del accionista es menor", penalty: 0.3 },
  cobranza_lenta: { text: "cuentas a cobrar altas contra los ingresos: factura mucho más de lo que cobra", penalty: 0.3 },
  ganancia_sin_ventas: { text: "el último trimestre vendió menos y ganó mucho más: revisá de dónde sale la ganancia", penalty: 0.3 },
  verificacion_reservas: { text: "verificación web con reservas", penalty: 0.3 },
  consenso_en_precio: { text: "el objetivo de consenso está a menos de 10% del precio: poco margen", penalty: 0.3 },
  subio_mucho_12m: { text: "subió más de 100% en 12 meses: el precio ya descuenta mucho", penalty: 0.3 },
};
const INFO: Record<string, string> = {
  resultado_extraordinario: "la ganancia reportada incluye extraordinarios: el ranking usa la ganancia núcleo",
  sin_estados: "sin estados de la SEC: las métricas son de Finnhub y pueden incluir extraordinarios",
  verificacion_pendiente: "verificación web pendiente (todavía no respondió el modelo)",
};
const SMALL_GROUP = 10;
const MIN_GAIN_PCT = 5;
const CALM_RISK = 5;

const r1 = (n: number) => n.toFixed(1);

/** Texto único de la salvedad por solapamiento: lo usan convicción y la línea del plan. */
export const overlapCaution = (o: Overlap) => `se mueve como ${o.with} que ya tenés (correlación ${o.corr.toFixed(2)})`;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${r1(n)}%`;

/**
 * `overweight`: tema → % de la cartera, solo los que ya superan el umbral de concentración.
 * `overlap`: símbolo → posición con la que más correlaciona por encima del umbral (ver `holdingsOverlap`).
 */
export function convictionFor(row: CandidateRow, tags: Tags | null, overweight: Record<string, number>, overlap: Record<string, Overlap> = {}, regime: MacroRegime | null = null): TopPick | null {
  if (row.kind !== "stock" || row.verdict !== "COMPRAR" || row.score === null) return null;
  if (row.stop === null || row.target === null || row.stop >= row.close || row.target <= row.close) return null;
  const gainPct = ((row.target - row.close) / row.close) * 100;
  const lossPct = ((row.stop - row.close) / row.close) * 100;
  const reasons: string[] = [];
  const cautions: string[] = [];
  const group = row.groupSize ?? 0;
  const reliability = Math.min(1, group / SMALL_GROUP);
  let conviction = row.score * reliability;

  reasons.push(`${row.rankInGroup ?? "?"}° de ${group} pares por fundamentals (score ${row.score.toFixed(2)})`);
  if (group < SMALL_GROUP) cautions.push(`grupo chico (${group} pares): el rank vale menos`);

  const risk = row.riskScore ?? CALM_RISK;
  if (risk > CALM_RISK) {
    conviction -= 0.1 * (risk - CALM_RISK);
    cautions.push(`riesgo ${risk}/10: papel volátil, respetá el tamaño`);
  }
  for (const f of row.flags) {
    if (POSITIVE[f]) {
      conviction += 0.2;
      reasons.push(POSITIVE[f]);
    } else if (NEGATIVE[f]) {
      conviction -= NEGATIVE[f].penalty;
      const ev = f === "evento_moderado" ? [...(row.events ?? [])].filter((e) => e.severity === "moderado").sort((a, b) => b.date.localeCompare(a.date))[0] : undefined;
      const vr = f === "verificacion_reservas" && row.verification?.reason ? `verificación web con reservas (${row.verification.date}): ${row.verification.reason}` : null;
      cautions.push(ev ? `evento moderado ${ev.date}: ${ev.headline}` : vr ?? NEGATIVE[f].text);
    } else if (INFO[f]) {
      cautions.push(INFO[f]);
    } else if (f === "verificacion_apta") {
      reasons.push(row.verification?.reason ? `verificación web apta (${row.verification.date}): ${row.verification.reason}` : "verificación web apta");
    }
  }
  reasons.push(`objetivo ${signed(gainPct)} contra stop ${signed(lossPct)} (2 a 1)`);
  if (gainPct < MIN_GAIN_PCT) {
    conviction -= 0.3;
    cautions.push(`objetivo a solo ${signed(gainPct)}: poco margen para comisiones y ruido`);
  }
  if (risk <= CALM_RISK) reasons.push(`riesgo ${risk}/10`);
  for (const theme of tags?.themes ?? []) {
    const pct = overweight[theme];
    if (pct !== undefined) {
      conviction -= 0.3;
      cautions.push(`ya tenés ${r1(pct)}% de la cartera en ${theme}`);
    }
  }
  const twin = overlap[row.symbol];
  if (twin) {
    conviction -= 0.3;
    cautions.push(overlapCaution(twin));
  }
  // Régimen restrictivo (pieza 4): lo sensible a tasas (REITs, servicios públicos, mineras de oro) suma menos.
  if (regime?.state === "restrictivo" && isRateSensitive(tags)) {
    conviction -= 0.3;
    cautions.push(`régimen restrictivo (${regime.why}): sensible a tasas`);
  }
  return { symbol: row.symbol, conviction: r4(conviction), gainPct: r4(gainPct), lossPct: r4(lossPct), reasons, cautions, allAligned: cautions.length === 0 };
}

export function topPicks(rows: CandidateRow[], tags: Record<string, Tags>, overweight: Record<string, number>, n = 5, overlap: Record<string, Overlap> = {}, regime: MacroRegime | null = null): TopPick[] {
  return rows
    .map((r) => convictionFor(r, tags[r.symbol] ?? null, overweight, overlap, regime))
    .filter((p): p is TopPick => p !== null)
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, n);
}
