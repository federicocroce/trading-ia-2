/**
 * Banderas del Radar: etiqueta y signo.
 *
 * Hasta el 2026-09-11 todas se pintaban igual, con el mismo símbolo de advertencia y el mismo gris.
 * "consenso de compra" y "verificación web: apta" son buenas noticias y se leían como salvedades, así que
 * una candidata sana parecía llena de problemas y el veredicto COMPRAR no se le creía. El signo importa
 * tanto como el texto: sin él, la pantalla dice lo contrario de lo que dice el cálculo.
 */
const FLAG_LABEL: Record<string, string> = {
  consenso_compra: "consenso de compra",
  consenso_venta: "consenso de venta",
  insiders_compran: "insiders compran",
  insiders_venden: "insiders venden",
  sorpresa_positiva: "sorpresa positiva",
  sorpresa_negativa: "sorpresa negativa",
  dividendo: "dividendo",
  // AES (16/9): el Radar le calculaba objetivo 15,93 "al doble del riesgo" contra una fusión en efectivo a 15,00 ya
  // votada por los accionistas. Lo prueba un formulario de la SEC (DEFM14A, PREM14A, SC 14D9 o 425).
  bajo_oferta_de_compra: "está bajo una oferta de compra: el precio lo fija el acuerdo, no el mercado",
  no_perseguir: "no perseguir (+15% en 21 ruedas)",
  resultados_cerca: "resultados en ≤ 10 días",
  residente_cronico: "residente crónico",
  bajo_stop: "bajo el stop dinámico",
  bajo_sma200: "bajo la SMA200",
  sin_historial: "sin 200 velas de historial",
  resultado_extraordinario: "ganancia con extraordinarios (ranking con núcleo)",
  sin_estados: "sin estados de la SEC",
  crecimiento_no_confiable: "banco: crecimiento de ingresos de Finnhub no confiable (fuera del ranking)",
  banco_sin_estados: "banco sin estados de la SEC: la app no puede leer su ganancia, así que queda en OBSERVAR y no entra al plan",
  evento_grave: "evento grave en 90 días",
  evento_moderado: "evento moderado en 90 días",
  eventos_sin_clasificar: "titulares sin clasificar",
  interes_minoritario: "socios minoritarios se llevan ≥ 20% de la ganancia",
  cobranza_lenta: "cuentas a cobrar ≥ 35% de los ingresos",
  ganancia_sin_ventas: "último trimestre: menos ventas, mucha más ganancia",
  salvedades_de_calidad: "dos o más salvedades de calidad o litigio",
  verificacion_apta: "verificación web: apta",
  verificacion_reservas: "verificación web: con reservas (resta convicción y se avisa; no frena)",
  verificacion_evitar: "verificación web: evitar",
  verificacion_pendiente: "verificación web pendiente",
  verificacion_anterior: "verificación apta con el cuestionario anterior: se repite sola y no frena la compra",
  consenso_en_precio: "objetivo de consenso a < 10% del precio",
  subio_mucho_12m: "subió > 100% en 12 meses",
  nucleo_por_calendario: "del núcleo: se compra por calendario, sin timing",
  fr_sin_dividendos: "fuerza relativa medida solo por precio: esta serie no trae dividendos, así que el número la subestima",
  stop_dentro_de_la_entrada: "el stop cae dentro de la franja de compra: no hay operación posible",
  en_linea: "el CEDEAR cotiza en línea con el CCL",
  caro_vs_ccl: "el CEDEAR está caro contra el CCL",
  barato_vs_ccl: "el CEDEAR está barato contra el CCL",
  ratio_dudoso: "el ratio cargado no coincide con el precio: revisar si hubo split",
  // Hechos externos (17/9): datos con fecha y fuente que carga el importador; la ficha muestra el detalle y el enlace.
  guia_subida: "subió la guía (hecho verificado)",
  guia_recortada: "recortó la guía (hecho verificado)",
  lider_en_retroceso: "líder en retroceso: la frena solo haber subido y hoy está en zona (lista que se mide; no entra al plan)",
  lider_esperando: "líder esperando su retroceso (lista que se mide; no entra al plan)",
  investigacion_abierta: "investigación regulatoria abierta (hecho verificado): un titular puede abrir con un salto por debajo del stop",
  objetivo_sobre_consenso: "el objetivo de la app está 15% o más arriba del consenso de analistas",
  guia_reafirmada: "reafirmó la guía (hecho verificado)",
  ganancia_por_reservas: "la ganancia lleva reservas liberadas: sin ellas no llega al consenso (hecho verificado)",
  ganancia_extraordinaria: "la ganancia no viene del negocio (valor razonable, venta de activos…): sin eso no llega al consenso (hecho verificado)",
};
/**
 * Banderas con un dato adentro, en la forma `nombre:dato`. Se traducen aparte porque el dato cambia por
 * símbolo y no puede vivir en el mapa de arriba.
 */
const FLAG_CON_DATO: Record<string, (dato: string) => string> = {
  serie_con_salto: (fecha) => `la serie de precios da un salto de escala el ${fecha}: un split que la fuente no ajustó`,
  fr6m_negativa: (v) => `le perdió al SPY en 6 meses (${redondear(v)}%)`,
  fr6m_negativa_merval: (v) => `le perdió al Merval en 6 meses (${redondear(v)}%)`,
  // 16/9: decía sólo "dividendo" y el campo del que salía estaba mal (HSBC figuraba con 5,55% y paga 0,78%).
  // Con el número a la vista se puede contrastar contra lo que declara la empresa.
  dividendo: (v) => `paga ${redondear(v)}% de dividendo (12 meses)`,
};
/** Los motores guardan el número completo; en pantalla, un decimal alcanza y sobra. */
const redondear = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : v;
};
/**
 * Escrituras viejas que siguen guardadas en las corridas anteriores al 13/9. El selector de fecha del
 * encabezado permite mirar cualquier corrida guardada, así que una bandera que dejó de emitirse tiene que
 * seguir siendo legible: si no, el histórico se degrada a texto crudo con cada cambio de nombre.
 */
const LEGADO: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^bajo SMA200$/, () => FLAG_LABEL["bajo_sma200"]!],
  [/^núcleo: se compra por calendario, sin timing$/, () => FLAG_LABEL["nucleo_por_calendario"]!],
  [/^fuerza relativa 6m (-?[\d.]+)% ≤ 0 contra (el Merval|SPY)$/, (m) => `le perdió al ${m[2] === "SPY" ? "SPY" : "Merval"} en 6 meses (${redondear(m[1]!)}%)`],
];

export const flagLabel = (flag: string): string => {
  const i = flag.indexOf(":");
  if (i > 0) {
    const f = FLAG_CON_DATO[flag.slice(0, i)];
    if (f) return f(flag.slice(i + 1));
  }
  const directa = FLAG_LABEL[flag];
  if (directa) return directa;
  for (const [re, fn] of LEGADO) {
    const m = flag.match(re);
    if (m) return fn(m);
  }
  return flag;
};

export type FlagTone = "bueno" | "salvedad" | "limitacion";

/** Señales a favor. Ninguna de estas resta en la convicción ni acerca a OBSERVAR. */
const BUENAS = new Set(["consenso_compra", "insiders_compran", "sorpresa_positiva", "dividendo", "verificacion_apta", "barato_vs_ccl", "guia_subida"]);
/**
 * Ni buenas ni malas: describen qué ES el instrumento o cómo está cotizando, y no restan nada. Que un ETF
 * sea del núcleo se pintaba en ámbar con el mismo ⚑ que una salvedad, y "en línea con el CCL", que es la
 * situación normal de un CEDEAR, también.
 */
const NEUTRAS = new Set(["nucleo_por_calendario", "en_linea", "lider_en_retroceso", "lider_esperando"]);
/** Ni a favor ni en contra: falta un dato. No es un defecto de la empresa, es un límite de la fuente. */
// `crecimiento_no_confiable`: el número de la fuente no sirve en bancos y el ranking ya no lo usa (NBN, 13/9).
// `banco_sin_estados`: tampoco es un defecto del banco; es que la app no lo puede verificar, y por eso no lo compra (14/9).
// `verificacion_anterior`: apta con un cuestionario viejo; no es verde porque el plan no la compra hasta repetirla (15/9).
const LIMITACIONES = new Set(["sin_estados", "sin_historial", "eventos_sin_clasificar", "verificacion_pendiente", "verificacion_anterior", "fr_sin_dividendos", "crecimiento_no_confiable", "banco_sin_estados", "guia_reafirmada"]);
/** Las que llevan un dato adentro y también son límites de la fuente, no defectos de la empresa. */
const LIMITACIONES_CON_DATO = new Set(["serie_con_salto"]);
/** Las que llevan un dato adentro y son a favor. `dividendo:` desde el 16/9. */
const BUENAS_CON_DATO = new Set(["dividendo"]);

/** Todo lo que no está declarado como bueno o como límite cuenta como salvedad: el default seguro. */
export function flagTone(flag: string): FlagTone {
  if (BUENAS.has(flag)) return "bueno";
  if (LIMITACIONES.has(flag) || NEUTRAS.has(flag)) return "limitacion";
  const i = flag.indexOf(":");
  if (i > 0 && BUENAS_CON_DATO.has(flag.slice(0, i))) return "bueno";
  if (i > 0 && LIMITACIONES_CON_DATO.has(flag.slice(0, i))) return "limitacion";
  // Misma neutralidad para la escritura vieja del núcleo, que sigue en las corridas guardadas.
  if (flag.startsWith("núcleo: ")) return "limitacion";
  return "salvedad";
}

export const FLAG_TONE_TITULO: Record<FlagTone, string> = {
  bueno: "A favor.",
  salvedad: "Salvedad: juega en contra (resta convicción, cuenta para pasar a OBSERVAR o frena la compra).",
  limitacion: "Falta el dato o es neutra: ni a favor ni en contra.",
};
/** Las únicas a favor que suman a la convicción (+0,2 cada una, `conviction.ts`). Las demás son buenas noticias sin puntaje. */
const SUMAN = new Set(["consenso_compra", "insiders_compran", "sorpresa_positiva"]);

/**
 * El título de una bandera dice lo que hace (15/9): "verificación web: apta" y "dividendo" decían "suma a la convicción"
 * y no suman nada. Una verificación apta es la condición para entrar al plan, no un premio.
 */
export function flagTitle(flag: string): string {
  const t = flagTone(flag);
  if (t !== "bueno") return FLAG_TONE_TITULO[t];
  return SUMAN.has(flag) ? "A favor: suma 0,2 a la convicción." : "A favor: es un dato bueno, pero no suma a la convicción.";
}

/** Cuántas salvedades reales tiene, que es lo único que hay que contar para decidir. */
export const countSalvedades = (flags: string[]): number => flags.filter((f) => flagTone(f) === "salvedad").length;
