/**
 * Sorpresas de resultados: el porcentaje con los números que lo produjeron.
 *
 * Por qué se muestran los dos números (16/9): la fila afirmaba "el último resultado decepcionó" y restaba 0,3 de
 * convicción apoyada en un porcentaje que no se podía contrastar con nada. SPNT marcaba −10,85% mientras su
 * comunicado del 29/7/2026 decía que había superado (ganancia operativa por acción de 0,67 contra un consenso de
 * 0,65). La cuenta (0,58 contable − 0,65) / 0,65 = −10,77% indica que el proveedor mide la ganancia CONTABLE contra
 * un consenso armado sobre la OPERATIVA, que son dos cosas distintas.
 *
 * No se corrige el número: no existe una fuente primaria de consenso, y fabricar uno sería tener dos varas. Lo que
 * se hace es mostrar contra qué se está midiendo.
 */
export interface SorpresaFila {
  period: string;
  /** Lo que la empresa reportó, según el proveedor. Ausente en las corridas guardadas antes del 16/9. */
  actual?: number | null;
  /** El consenso que el proveedor usó. Ausente en las corridas guardadas antes del 16/9. */
  estimate?: number | null;
  surprisePercent: number | null;
}

const pct = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;

export function sorpresaTexto(s: SorpresaFila): string {
  const mes = s.period.slice(0, 7);
  if (s.surprisePercent === null || s.surprisePercent === undefined) return `${mes} s/d`;
  const base = `${mes} ${pct(s.surprisePercent)}`;
  if (typeof s.actual !== "number" || typeof s.estimate !== "number") return base;
  return `${base} (${s.actual} contra ${s.estimate} esperado)`;
}

export function sorpresasTexto(filas: SorpresaFila[] | null | undefined): string | null {
  if (!filas?.length) return null;
  return `Sorpresas de resultados (Finnhub: puede comparar la ganancia contable contra un consenso operativo): ${filas.map(sorpresaTexto).join(", ")}.`;
}
