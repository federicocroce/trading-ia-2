/**
 * La fecha de resultados que se muestra (10/10). Con dos fuentes que difieren se muestran las dos: Nasdaq primero,
 * porque donde se pudo verificar con la empresa acertó (DXCM 29/10, NEM 22/10, TSM 15/10) y Finnhub no. La regla
 * de "resultados cerca" frena con cualquiera de las dos, así que esconder una sería esconder por qué frena.
 */
export function fechaDeResultados(finnhub: string | null | undefined, nasdaq: string | null | undefined): string | null {
  const f = finnhub || null;
  const n = nasdaq || null;
  if (!f && !n) return null;
  if (!f) return n;
  if (!n || n === f) return f;
  return `${n} (Nasdaq; Finnhub dice ${f})`;
}
