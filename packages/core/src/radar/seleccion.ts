/**
 * Qué filas guarda el Radar de la preselección, una vez pasado el filtro técnico.
 *
 * El corte era por PUNTAJE y no por comprable, y eso dejaba el Radar con 30 filas en OBSERVAR y 10 en COMPRAR
 * (16/9/2026), mientras 13 acciones que habían pasado todos los filtros y quedaban en COMPRAR se caían del corte,
 * con puestos del 77 al 149. El sesgo importaba más que el número: de las que no se veían, 8 eran seguros, 7
 * servicios financieros, 6 salud y 4 bancos — justo lo que no se mueve con Argentina ni con el petróleo.
 *
 * La regla sólo AGREGA. Las primeras `top` por puntaje entran igual que antes, así que ninguna fila que ya estaba
 * se pierde; lo nuevo es que una COMPRAR que quedaba afuera entra, hasta `maxRows`.
 *
 * Hay tope porque cada fila cuesta: por cada una la corrida pide ficha, insiders, analistas y sorpresas (4 pedidos
 * a Finnhub), más sus eventos y filings. Trece filas más son unos 52 pedidos por corrida.
 *
 * `evaluadas` viene ordenada por puntaje y la salida respeta ese orden.
 */
/**
 * Dónde entra, a mitad de semana, una acción de la preselección que hoy quedó COMPRAR y no está en el Radar (24/9).
 *
 * El ranking del domingo elige las filas con `seleccionarCandidatas`; el refresco diario solo las rehacía. Entre el 20 y
 * el 24/9 las COMPRAR del Radar bajaron de 52 a 31 sin que entrara ninguna, y GLXY (puesto 25) cruzó su media de 200 el
 * lunes y no apareció. Esta es la misma regla con los veredictos del día: las `top` por puntaje no se tocan, un lugar
 * libre hasta `maxRows` se ocupa primero, y si no hay, sale la OBSERVAR de peor puntaje fuera de las `top` que no esté
 * en cartera. Una COMPRAR nunca le cede su lugar a otra. `null` = no hay lugar.
 *
 * `actuales` son las filas de acciones del día; el orden no importa.
 */
export function lugarParaNueva(
  actuales: ReadonlyArray<{ symbol: string; score: number | null; verdict: "COMPRAR" | "OBSERVAR" }>,
  protegidas: ReadonlySet<string>,
  p: { top: number; maxRows?: number | undefined },
): { libre: true } | { libre: false; sale: string } | null {
  const tope = Math.max(p.maxRows ?? p.top * 2, p.top);
  if (actuales.length < tope) return { libre: true };
  const porPuntaje = [...actuales].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const intocables = new Set(porPuntaje.slice(0, p.top).map((a) => a.symbol));
  const cedibles = porPuntaje.filter((a) => !intocables.has(a.symbol) && a.verdict === "OBSERVAR" && !protegidas.has(a.symbol.toUpperCase()));
  const peor = cedibles[cedibles.length - 1];
  return peor ? { libre: false, sale: peor.symbol } : null;
}

export function seleccionarCandidatas<T>(
  evaluadas: ReadonlyArray<{ item: T; verdict: "COMPRAR" | "OBSERVAR" }>,
  p: { top: number; maxRows?: number | undefined },
): T[] {
  const tope = Math.max(p.maxRows ?? p.top * 2, p.top);
  const elegidas: T[] = [];
  const porPuntaje = new Set<number>();
  for (let i = 0; i < evaluadas.length && porPuntaje.size < p.top; i++) porPuntaje.add(i);
  for (let i = 0; i < evaluadas.length; i++) {
    if (elegidas.length >= tope) break;
    const e = evaluadas[i]!;
    if (porPuntaje.has(i) || e.verdict === "COMPRAR") elegidas.push(e.item);
  }
  return elegidas;
}
