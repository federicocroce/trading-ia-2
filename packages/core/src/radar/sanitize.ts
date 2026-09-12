import type { FinnhubMetrics } from "./universe.js";

/**
 * Saneo de métricas antes de puntuar (2026-09-12). Puro.
 *
 * El puntaje compara cada métrica contra la mediana de los pares. Eso funciona mientras la métrica
 * signifique algo. Dos casos verificados contra balances el 11/9 muestran que a veces no significa nada
 * y encima suma:
 *
 * - DaVita declaraba ROE de 181% con patrimonio de −765 millones, borrado por recompras. El ROE ahí mide
 *   un denominador que ya no existe, y el eje de calidad lo leía como excelencia operativa.
 * - Alphabet declaraba margen neto de 54,8% contra un operativo de 33,1%, por 99.000 millones de
 *   revalorización no realizada de SpaceX. El eje de calidad lo leía como rentabilidad del negocio.
 *
 * Regla de diseño: **acá solo se quitan premios, nunca castigos.** Una deuda sobre patrimonio absurda se
 * deja entrar tal cual, porque penalizar a una empresa con el patrimonio destruido es correcto. Lo que se
 * anula es únicamente el número que la haría parecer mejor de lo que es. Si la regla se equivoca, el costo
 * es dejar afuera del puntaje un dato bueno, no meter uno malo.
 */
export const SANITIZE_THRESHOLDS = {
  /** Deuda sobre patrimonio por encima de esto: el patrimonio está cerca de cero y el ROE es un artefacto. */
  debtToEquityAbsurd: 20,
  /** Cuánto puede superar el margen neto al operativo antes de que la ganancia sea claramente de afuera. */
  marginGapPct: 5,
};

export interface SanitizeResult {
  metrics: FinnhubMetrics;
  /** Qué se quitó y por qué, para poder explicarlo en la ficha en vez de mostrar un hueco sin motivo. */
  removed: Array<{ key: string; reason: string }>;
}

export function sanitizeMetrics(metrics: FinnhubMetrics): SanitizeResult {
  const out: FinnhubMetrics = { ...metrics };
  const removed: SanitizeResult["removed"] = [];
  const num = (k: string): number | null => {
    const v = metrics[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const de = num("totalDebt/totalEquityAnnual");
  if (de !== null && Math.abs(de) > SANITIZE_THRESHOLDS.debtToEquityAbsurd) {
    // El ROE deja de medir rentabilidad. La deuda sobre patrimonio se deja: ahí el castigo es correcto.
    for (const k of ["roeTTM", "roe5Y", "roeRfy"]) {
      if (num(k) !== null) {
        out[k] = null;
        removed.push({ key: k, reason: `deuda/patrimonio ${de}: el patrimonio quedó cerca de cero o negativo, el ROE mide el denominador` });
      }
    }
  }

  const op = num("operatingMarginTTM");
  const neta = num("netProfitMarginTTM");
  if (op !== null && neta !== null && neta > 0 && neta > op + SANITIZE_THRESHOLDS.marginGapPct) {
    out["netProfitMarginTTM"] = null;
    removed.push({ key: "netProfitMarginTTM", reason: `margen neto ${neta}% arriba del operativo ${op}%: la ganancia no viene de la operación` });
  }

  return { metrics: out, removed };
}
