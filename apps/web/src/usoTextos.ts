/**
 * Textos de la pestaña Uso y del panel de Corridas. Puros, para poder probarlos sin dibujar nada.
 * Todas las horas en hora de Argentina (regla del 15/9: una hora nunca se muestra en otra zona).
 */
const ZONA = "America/Argentina/Buenos_Aires";

export function horaAR(iso: string, conSegundos = false): string {
  return new Date(iso).toLocaleTimeString("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", ...(conSegundos ? { second: "2-digit" } : {}), hourCycle: "h23" });
}

const diaAR = (iso: string) => {
  const p = new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, day: "numeric", month: "numeric" }).formatToParts(new Date(iso));
  return `${p.find((x) => x.type === "day")!.value}/${p.find((x) => x.type === "month")!.value}`;
};

/**
 * Celda "cuota diaria" de Gemini por modelo y clave. El 15/9 decía "agotada hoy" en la clave 1 de 2.5-flash desde
 * el 429 de las 10:51, y la clave siguió contestando bien a las 14:56 y a las 15:48. Agotada es solo un 429 por día
 * sin ninguna respuesta buena después (lo decide el servidor en `exhausted`); si hubo, se dicen las dos horas.
 */
export function cuotaDiaria(g: { rpd: number; exhausted: boolean; lastRpdAt: string | null; lastOkAt: string | null }): { texto: string; tono: "bad" | "warn" | "muted" } {
  if (g.exhausted && g.lastRpdAt) return { texto: `agotada desde las ${horaAR(g.lastRpdAt)}`, tono: "bad" };
  if (g.rpd > 0 && g.lastRpdAt && g.lastOkAt) return { texto: `429 por día a las ${horaAR(g.lastRpdAt)}, pero respondió bien a las ${horaAR(g.lastOkAt)}: no está agotada`, tono: "warn" };
  // Un 429 por día de antes del reinicio de las 04:00 es de la cuota del día anterior.
  if (g.rpd > 0) return { texto: "429 por día antes del reinicio de las 04:00: es de la cuota anterior", tono: "muted" };
  return { texto: "—", tono: "muted" };
}

/**
 * Cuánto del día cubre el registro. Del 10 al 13/9 la tabla no tenía filas y la pestaña dibujaba esos días como cero
 * llamadas: un hueco presentado como un resultado. El mismo 15/9, a las 17:15, la tabla se vació: no se dice "el
 * registro empieza", se dice lo que hay, que es no tener llamadas guardadas antes de esa hora.
 */
export function coberturaTexto(state: "completo" | "parcial" | "sin_registro", desde: string | null): string | null {
  if (state === "completo" || !desde) return null;
  if (state === "sin_registro") return `sin registro: no hay llamadas guardadas antes del ${diaAR(desde)} a las ${horaAR(desde)}`;
  return `registro desde las ${horaAR(desde)}: antes de esa hora no hay llamadas guardadas`;
}

/** El día de la pantalla se corta a la medianoche de acá; la cuota de Gemini, a la de California (04:00 o 05:00 acá). */
export function corteDelDia(quotaResetAt: string | null): string {
  if (!quotaResetAt) return "El día va de 00:00 a 24:00, hora de Argentina. La cuota gratis de Gemini se reinicia a la medianoche de California (04:00 o 05:00 acá): lo anterior cuenta para la cuota del día previo.";
  const h = horaAR(quotaResetAt);
  return `El día va de 00:00 a 24:00, hora de Argentina. La cuota gratis de Gemini se reinicia a las ${h}: lo de 00:00 a ${h} cuenta para la cuota del día anterior.`;
}
