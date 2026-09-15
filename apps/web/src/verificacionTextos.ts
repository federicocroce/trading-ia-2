/**
 * Lógica de la sección "Verificación y estados" de la ficha y del Radar. Pura, para poder probarla sin dibujar nada.
 */

type Veredicto = "apto" | "con_reservas" | "evitar";
const ETIQUETA: Record<Veredicto, string> = { apto: "APTA", con_reservas: "CON RESERVAS", evitar: "EVITAR" };
const CLASE: Record<Veredicto, string> = { apto: "verb COMPRAR", con_reservas: "verb OBSERVAR", evitar: "bad" };

/**
 * Cómo se lee la verificación web de un símbolo (15/9). Cuatro estados, no dos:
 * - `vigente`: hecha con el cuestionario que el plan acepta; se ve como siempre.
 * - `anterior`: hecha con el cuestionario viejo. NBN y NVDA estaban APTAS así y se veían en verde, cuando el plan no
 *   las compra hasta repetirla. Una APTA vieja va apagada; una advertencia vieja conserva su color (no se apaga un aviso).
 * - `pendiente`: la fila queda COMPRAR por reglas y el modelo todavía no la verificó (SNDK, BLBD). El texto general
 *   "se verifica solo lo que queda COMPRAR" era falso justo para ellas.
 * - `sin`: no hay verificación y la fila no es COMPRAR; ahí la regla general sí es cierta.
 * `current` null = no se sabe cuál es el vigente (no hay verificador): se muestra como vigente, igual que antes.
 */
export function estadoVerificacion(i: { v: { verdict: Veredicto } | null | undefined; current: boolean | null | undefined; fila?: { verdict: string; flags: string[] } | null | undefined }): { kind: "vigente" | "anterior" | "pendiente" | "sin"; chip: { label: string; className: string } | null; nota: string | null } {
  if (i.v) {
    const anterior = i.current === false;
    const className = anterior && i.v.verdict === "apto" ? "verb CANDIDATA" : CLASE[i.v.verdict];
    return { kind: anterior ? "anterior" : "vigente", chip: { label: ETIQUETA[i.v.verdict], className }, nota: anterior ? "cuestionario anterior: se repite antes de comprar" : null };
  }
  const pendiente = !!i.fila && (i.fila.flags.includes("verificacion_pendiente") || i.fila.verdict === "COMPRAR");
  if (pendiente) return { kind: "pendiente", chip: null, nota: "verificación web pendiente: queda COMPRAR por reglas y el modelo todavía no la verificó. El plan no la compra hasta que se verifique." };
  return { kind: "sin", chip: null, nota: "sin verificación web: se verifica solo lo que queda COMPRAR por reglas, y se repite a los 7 días" };
}

/** Cuántas fuentes tuvo el dictamen (15/9: APH tenía 0 guardadas y TSM 42, y la pantalla mostraba hasta 8 sin decirlo). */
export function fuentesTexto(total: number, mostradas = 8): string {
  if (total === 0) return "sin fuentes: el modelo no devolvió enlaces, así que este dictamen no se puede comprobar";
  return total > mostradas ? `Fuentes (${mostradas} de ${total}):` : `Fuentes (${total}):`;
}

/**
 * Banda de credibilidad de la ganancia por acción del núcleo contra la de la fuente: la MISMA que `CORE_EPS_BAND` del
 * núcleo (packages/core/src/radar/statements.ts), que la usa para no reemplazar el P/E de Finnhub. El test las compara.
 */
export const BANDA_EPS_NUCLEO = { min: 1 / 3, max: 3 };

/**
 * P/E sobre la ganancia núcleo. El 15/9 SNDK mostraba "P/E núcleo 0,1 (Finnhub 22,3)": 1.518,66 / 10.881 de EPS,
 * porque el último trimestre venía con 1.000.000 de acciones diluidas contra ~157 millones de los anteriores. El
 * núcleo ya descarta ese número (no reemplaza el P/E de la fuente), pero la pantalla dividía igual. Fuera de la banda
 * no se muestra: no es un ajuste por extraordinarios, es un error de extracción de acciones.
 */
export function peNucleo(i: { close: number | null; coreEps: number | null | undefined; epsFuente: number | null | undefined }): { valor: number | null; texto: string; motivo: string | null } {
  const eps = i.coreEps;
  if (eps === null || eps === undefined || eps <= 0 || !i.close) return { valor: null, texto: "—", motivo: null };
  const fuente = i.epsFuente;
  if (fuente !== null && fuente !== undefined && fuente > 0) {
    const r = eps / fuente;
    if (r < BANDA_EPS_NUCLEO.min || r > BANDA_EPS_NUCLEO.max) {
      return { valor: null, texto: "—", motivo: `la ganancia por acción del núcleo (${eps.toFixed(2)}) no es creíble contra la de Finnhub (${fuente.toFixed(2)}): ${r.toFixed(1)} veces, casi siempre un error en las acciones de un trimestre de la SEC. El núcleo tampoco la usa: vale el P/E de Finnhub` };
    }
  }
  const valor = i.close / eps;
  return { valor, texto: valor.toFixed(1), motivo: null };
}
