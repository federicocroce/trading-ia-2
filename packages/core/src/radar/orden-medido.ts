import type { CandidateRow } from "./types.js";

/**
 * El orden con el que el plan elige acciones nuevas (10/10). Reemplaza a la convicción, que medida no ordenaba: el
 * tercer quinto por convicción rendía +1,52% a 7 días y el segundo −2,86% (31 fechas, `pnpm conviccion`).
 *
 * Medido el 10/10 sobre las COMPRAR de la app con alfa a 7 días: 24 fechas, 718 filas, 153 símbolos. Cada condición se
 * sostiene en LAS DOS MITADES de la muestra, que es la prueba contra el ruido:
 *
 *   condición                                  alfa 7d con / sin        1ra mitad   2da mitad
 *   riesgo ≥ 6                                 −2,25% / −0,31%          −3,16%      −1,98%
 *   balance < −0,5 contra sus pares            −1,34% / −0,80%          −2,64%      −0,80%
 *   sorpresa positiva en resultados            +0,15% / −2,67%          −0,24%      +0,29%
 *   las tres juntas (sorpresa, riesgo<6, bal.)  +1,02% / −1,88%          +1,87%      +0,74%
 *   líder en retroceso                          +2,20% / −1,08%          (solo hay 2da mitad: arrancó el 21/9)
 *
 * A 30 días todo el grupo pierde (las tres juntas −6,3% contra −7,6%): el filtro achica la pérdida, no la da vuelta.
 * Eso se dice junto con la regla, no en su lugar.
 *
 * Lo que NO entra al orden porque no se sostuvo: valuación, crecimiento y el puntaje entero (inconsistentes entre
 * mitades), el puesto en el grupo, la extensión sobre la media de 20.
 *
 * Los líderes en retroceso van primero pero con tope (`LIDERES_MAX`): su señal es la más fuerte y la menos probada
 * (10 símbolos, todavía sin 30 días). Decisión del dueño del 10/10: darles lugar igual.
 */
export const RIESGO_MAX_MEDIDO = 6;
export const BALANCE_MIN_MEDIDO = -0.5;
export const LIDERES_MAX = 2;

export interface OrdenMedido {
  /** 2 = líder en retroceso, 1 = cumple las tres condiciones medidas, null = no entra como nueva. */
  prioridad: 2 | 1 | null;
  lider: boolean;
  /** Por qué no entra, en palabras; vacío si entra. */
  motivo: string;
}

export function ordenMedido(row: Pick<CandidateRow, "flags" | "riskScore" | "axes">): OrdenMedido {
  if (row.flags.includes("lider_en_retroceso")) return { prioridad: 2, lider: true, motivo: "" };
  const faltan: string[] = [];
  if (!row.flags.includes("sorpresa_positiva")) faltan.push("sin sorpresa positiva en sus últimos resultados");
  const riesgo = row.riskScore;
  if (riesgo === null || riesgo === undefined) faltan.push("sin medida de riesgo");
  else if (riesgo >= RIESGO_MAX_MEDIDO) faltan.push(`riesgo ${riesgo}/10 (desde ${RIESGO_MAX_MEDIDO} rinde peor)`);
  const balance = row.axes?.["balance"];
  if (typeof balance === "number" && balance < BALANCE_MIN_MEDIDO) faltan.push(`balance flojo contra sus pares (${balance.toFixed(2).replace(".", ",")})`);
  return faltan.length ? { prioridad: null, lider: false, motivo: faltan.join(", ") } : { prioridad: 1, lider: false, motivo: "" };
}
