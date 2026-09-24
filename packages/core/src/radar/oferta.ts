/**
 * Una empresa bajo oferta de compra no se puede valuar con las reglas del Radar.
 *
 * AES el 16/9/2026: 77ª por puntaje, COMPRAR, franja 14,81-15,11, stop 14,70 y objetivo 15,93 "al doble del riesgo".
 * Ese objetivo no puede pasar: el 1/3/2026 firmó una fusión a USD 15,00 por acción en efectivo, aprobada por los
 * accionistas el 26/6/2026 con el 97,9% de los votos. Lo que quedaba por ganar era 1,28% y si el acuerdo se caía la
 * referencia sin oferta era ~11 dólares, un 25% abajo.
 *
 * El problema es que una acción así le parece PERFECTA al Radar: se mueve poco (ATR bajo), el riesgo medido da
 * bajo, y los múltiplos quedan baratos contra sus pares porque el precio está clavado contra un número fijo. Todas
 * las señales apuntan al lado equivocado a la vez.
 *
 * La prueba es el formulario, no el titular. Estos cuatro sólo existen cuando hay una fusión o una oferta en curso:
 * el poder para votarla (DEFM14A y su versión preliminar PREM14A), la respuesta obligatoria del directorio a una
 * oferta pública de adquisición (SC 14D9) y las comunicaciones de fusión (425). Un 8-K item 1.01 NO alcanza: es
 * "acuerdo material definitivo" y lo usa cualquier crédito bancario.
 *
 * El 17/9/2026 se verificó en EDGAR contra el top-300 de la preselección: la regla marcaba "bajo oferta" a FOXA,
 * LLYVK, VCTR y VLY, que sólo tienen 425 entre sus filings recientes. El 425 no alcanza solo: lo presentan LAS DOS
 * partes de una fusión, incluida la compradora, y FOX CORP tiene once 425 propios porque está comprando a Roku, no
 * porque la estén vendiendo a ella. Por eso el 425 cuenta sólo si el mismo emisor también presentó un DEFM14A, un
 * PREM14A o un SC 14D9: son los que prueba que ESE emisor es el que está en venta.
 */
export const FORMULARIOS_DE_OFERTA = ["DEFM14A", "PREM14A", "SC 14D9", "425"] as const;

/**
 * Título que escribe la consulta a EDGAR cuando confirmó un anuncio de fusión (ver `anuncioDeFusion`): no es un
 * formulario de la SEC, es la pareja 8-K + DEFA14A con el texto leído. Prueba solo.
 */
export const ANUNCIO_DE_FUSION = "ANUNCIO DE FUSION";

/** Formularios cuya sola presencia prueba que la empresa está en venta (a diferencia del 425, ver arriba). */
const FORMULARIOS_QUE_PRUEBAN_SOLOS = ["DEFM14A", "PREM14A", "SC 14D9"] as const;

/** Cuánto vale el anuncio: para entonces la fusión tiene su PREM14A (que dura 400 días) o se cayó. */
export const VENTANA_ANUNCIO_DIAS = 120;
const DIA = 86_400_000;

/** Un filing como lo lista el JSON de submissions de EDGAR; `ref` es lo que identifica al documento para leerlo. */
export interface FilingListado<R = string> { form: string; fecha: string; items: string; ref: R }

/**
 * El 8-K que hay que leer para saber si la empresa acaba de firmar su venta, o null. Es el 8-K con item 1.01 que el
 * emisor presentó el mismo día que un DEFA14A (o con un día de diferencia), en los últimos `VENTANA_ANUNCIO_DIAS`.
 *
 * Por qué hace falta (24/9): el PREM14A llega semanas después del anuncio, y mientras tanto MG, BWIN y PRTH figuraban
 * como empresas libres. Por qué no alcanza con la pareja: un acuerdo de cooperación con un activista tiene la misma
 * forma. Por eso devuelve el 8-K a leer, y lo decide `textoDeFusion`.
 */
export function anuncioDeFusion<R>(filings: ReadonlyArray<FilingListado<R>>, today: string): FilingListado<R> | null {
  const hoy = Date.parse(today);
  const vigente = (f: FilingListado<R>) => { const edad = (hoy - Date.parse(f.fecha)) / DIA; return edad >= 0 && edad <= VENTANA_ANUNCIO_DIAS; };
  const votaciones = filings.filter((f) => f.form === "DEFA14A" && vigente(f)).map((f) => Date.parse(f.fecha));
  if (!votaciones.length) return null;
  const candidatos = filings
    .filter((f) => f.form === "8-K" && vigente(f) && f.items.split(",").map((i) => i.trim()).includes("1.01"))
    .filter((f) => votaciones.some((d) => Math.abs(d - Date.parse(f.fecha)) <= DIA))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  return candidatos[0] ?? null;
}

/** Frases de un acuerdo de fusión. "Merger" suelto no: aparece en cualquier cosa. */
const FRASES_DE_FUSION = /agreement\s+and\s+plan\s+of\s+merger|\bmerger\s+agreement\b|arrangement\s+agreement|\btender\s+offer\b/i;
/** En el 8-K de la vendida, el vehículo de la fusión es subsidiaria del comprador ("Parent", "Purchaser"…): MG, TBRG, BWIN, PRTH. */
const LA_VENDIDA = /wholly[- ]owned\s+subsidiary\s+of\s+(\w+\s+)?(parent|purchaser|buyer|acquiror|acquirer)\b/i;
/** En el de la compradora, la empresa es la que compra: VCTR, 31/8. */
const LA_COMPRADORA = /the\s+company\s+(will|shall|has\s+agreed\s+to)\s+acquire/i;

/**
 * ¿El 8-K anuncia la venta de la empresa que lo presenta? Tiene que ser un acuerdo de fusión (el de cooperación de ITGR
 * no lo es) y la empresa tiene que ser la vendida: la compradora también presenta DEFA14A cuando emite acciones y sus
 * accionistas votan (VCTR, 31/8, comprando First Eagle), y su 8-K dice "Agreement and Plan of Merger" igual.
 */
export function textoDeFusion(texto: string): boolean {
  return FRASES_DE_FUSION.test(texto) && LA_VENDIDA.test(texto) && !LA_COMPRADORA.test(texto);
}

/**
 * El formulario que prueba que la empresa está bajo oferta de compra, o null si ninguno lo hace.
 *
 * `titulos` son los títulos de filings recientes tal como los guarda el ingestor de EDGAR:
 * `"<formulario>[ (items …)] — <nombre de la empresa>"`. Se mira sólo el formulario, que es lo que está antes del
 * primer espacio o guión, para que el nombre de una empresa no dispare la regla.
 *
 * Un DEFM14A, un PREM14A o un SC 14D9 prueban solos. Un 425 sólo cuenta si en la misma lista también aparece uno
 * de esos tres del mismo emisor (ver el caso FOXA/ROKU del 17/9 arriba); si el 425 está solo, se lo ignora.
 */
export function bajoOfertaDeCompra(titulos: readonly string[]): string | null {
  const encontrados: string[] = [];
  let anuncio = false;
  for (const t of titulos) {
    const formulario = t.split(" — ")[0]?.replace(/\s*\(items[^)]*\)\s*$/, "").trim();
    if (!formulario) continue;
    if (formulario === ANUNCIO_DE_FUSION) anuncio = true;
    const hit = FORMULARIOS_DE_OFERTA.find((f) => f === formulario);
    if (hit) encontrados.push(hit);
  }
  // El formulario de la SEC, si ya lo hay, es mejor prueba que el anuncio leído.
  return encontrados.find((f): f is (typeof FORMULARIOS_QUE_PRUEBAN_SOLOS)[number] =>
    (FORMULARIOS_QUE_PRUEBAN_SOLOS as readonly string[]).includes(f)
  ) ?? (anuncio ? ANUNCIO_DE_FUSION : null);
}
