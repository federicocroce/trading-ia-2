/**
 * El registro de aciertos (10/10): "si hubieras hecho lo que dijo la app". Decisión del dueño, para que la confianza
 * salga de resultados medidos y no de explicaciones. Tres cosas, cada una desde el día en que se dijo:
 *
 * - **Compras del plan**: cada acción desde el primer día que fue línea del plan. Acierta si le gana al S&P.
 * - **Ventas de Cartera**: cada racha de VENDER desde su primer día. Acierta si después rindió MENOS que el S&P
 *   (vender evitó esa diferencia).
 * - **Vetos del analista**: cada "no" desde su primer día. Acierta igual que una venta.
 *
 * Precio de cierre del día de la señal contra el último cierre. Puro: los precios los da quien llama.
 */
export type TipoRegistro = "compra_plan" | "venta_cartera" | "veto_analista";
export interface EntradaRegistro { tipo: TipoRegistro; symbol: string; desde: string; detalle?: string }
export interface FilaRegistro extends EntradaRegistro {
  precioDesde: number | null;
  precioHoy: number | null;
  hoy: string | null;
  retornoPct: number | null;
  spyPct: number | null;
  alfaPct: number | null;
  /** Compra: le ganó al S&P. Venta o veto: rindió menos que el S&P. null si todavía no hay ni una rueda. */
  acerto: boolean | null;
}
export interface ResumenRegistro { tipo: TipoRegistro; senales: number; medidas: number; retornoMedioPct: number | null; alfaMedioPct: number | null; aciertoPct: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100;
const media = (xs: number[]) => (xs.length ? r2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function medirRegistro(entradas: readonly EntradaRegistro[], precioEn: (symbol: string, fecha: string) => number | null, ultimo: (symbol: string) => { fecha: string; close: number } | null): { filas: FilaRegistro[]; resumen: ResumenRegistro[] } {
  const spyHoy = ultimo("SPY");
  const filas: FilaRegistro[] = entradas.map((e) => {
    const precioDesde = precioEn(e.symbol, e.desde);
    const u = ultimo(e.symbol);
    const spyDesde = precioEn("SPY", e.desde);
    const seMidio = precioDesde !== null && u !== null && u.fecha > e.desde && spyDesde !== null && spyHoy !== null;
    const retornoPct = seMidio ? r2((u!.close / precioDesde! - 1) * 100) : null;
    const spyPct = seMidio ? r2((spyHoy!.close / spyDesde! - 1) * 100) : null;
    const alfaPct = retornoPct !== null && spyPct !== null ? r2(retornoPct - spyPct) : null;
    const acerto = alfaPct === null ? null : e.tipo === "compra_plan" ? alfaPct > 0 : alfaPct < 0;
    return { ...e, precioDesde, precioHoy: u?.close ?? null, hoy: u?.fecha ?? null, retornoPct, spyPct, alfaPct, acerto };
  });
  const resumen = (["compra_plan", "venta_cartera", "veto_analista"] as const).map((tipo): ResumenRegistro => {
    const de = filas.filter((f) => f.tipo === tipo);
    const med = de.filter((f) => f.alfaPct !== null);
    return { tipo, senales: de.length, medidas: med.length, retornoMedioPct: media(med.map((f) => f.retornoPct!)), alfaMedioPct: media(med.map((f) => f.alfaPct!)), aciertoPct: med.length ? Math.round((100 * med.filter((f) => f.acerto).length) / med.length) : null };
  });
  return { filas, resumen };
}

/** El primer día de cada racha de VENDER de Cartera: una señal por racha, no una por día. */
export function rachasDeVenta(veredictos: ReadonlyArray<{ symbol: string; verdictDate: string; verb: string }>): EntradaRegistro[] {
  const porSimbolo = new Map<string, Array<{ fecha: string; verb: string }>>();
  for (const v of veredictos) porSimbolo.set(v.symbol.toUpperCase(), [...(porSimbolo.get(v.symbol.toUpperCase()) ?? []), { fecha: v.verdictDate, verb: v.verb }]);
  const out: EntradaRegistro[] = [];
  for (const [symbol, vs] of porSimbolo) {
    let anterior: string | null = null;
    for (const v of vs.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      if (v.verb === "VENDER" && anterior !== "VENDER") out.push({ tipo: "venta_cartera", symbol, desde: v.fecha });
      anterior = v.verb;
    }
  }
  return out;
}
