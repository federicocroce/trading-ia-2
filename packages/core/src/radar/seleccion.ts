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
