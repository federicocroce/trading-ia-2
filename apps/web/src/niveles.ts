/**
 * Textos de los niveles de la ficha y del gráfico. Puros, para poder probarlos sin dibujar nada.
 */

const coma = (n: number, d: number) => n.toFixed(d).replace(".", ",");

/**
 * Relación ganancia/pérdida de la orden. Sin posición (niveles del Radar) se mide desde el techo de compra,
 * igual que la tarjeta del Radar: es el peor precio al que se entra. El 14/9 la ficha de APH decía
 * "relación 18,0 : 1" porque medía desde el precio en vivo, que había caído a 1,6% del stop: una orden
 * más cerca del stop parecía mejor, cuando lo que pasaba es que el stop había quedado dentro del ruido del día.
 *
 * Con posición (Cartera) no hay relación: no hay orden que evaluar. El 15/9 TSM decía "relación 67,8 : 1 desde el
 * precio actual" porque el precio estaba a 1,76 del stop: cuanto más cerca del stop, mejor parecía. Con posición va la
 * distancia al stop (`distanciaAlStop`).
 */
export function relacionDeLaOrden(i: { stop: number | null; target: number | null; price: number | null; entryHigh: number | null | undefined; desde: "Radar" | "Cartera" | null }): { ratio: number; base: number; texto: string } | null {
  if (i.desde === "Cartera") return null;
  const techo = i.desde === "Radar" && i.entryHigh ? i.entryHigh : null;
  const base = techo ?? i.price;
  if (!base || i.stop === null || i.target === null || i.stop >= base || i.target <= base) return null;
  const ratio = (i.target - base) / (base - i.stop);
  const desde = techo !== null ? `desde el techo de compra ${coma(techo, 2)}, como en el Radar` : "desde el precio actual";
  return { ratio, base, texto: `relación ${coma(ratio, 1)} : 1 ${desde}` };
}

/** A menos de esto del stop, el ruido de un día lo toca: 1 ATR (el mismo `STOP_NOISE_ATR` del plan) o 1%. */
const STOP_CERCA_ATR = 1;
const STOP_CERCA_PCT = 1;

/**
 * Con posición, cuánto le queda al precio actual hasta el stop, en % y en ATR de 14 ruedas, con aviso si está pegado
 * (15/9: TSM a 414,57 con el stop en 412,81, 0,42% y 0,2 ATR, y la ficha mostraba "relación 67,8 : 1"). null si el
 * precio ya está debajo del stop (eso lo dice su propio aviso) o falta un dato.
 */
export function distanciaAlStop(i: { price: number | null; stop: number | null; atr: number | null | undefined }): { pct: number; enAtr: number | null; texto: string; aviso: string | null } | null {
  if (!i.price || i.stop === null || i.price <= i.stop) return null;
  const d = i.price - i.stop;
  const pct = (d / i.price) * 100;
  const enAtr = i.atr && i.atr > 0 ? d / i.atr : null;
  const texto = `a ${coma(pct, 2)}% del stop${enAtr !== null ? ` (${coma(enAtr, 1)} ATR)` : ""} desde el precio actual`;
  const aviso = enAtr !== null && enAtr < STOP_CERCA_ATR ? "pegado al stop: a menos de 1 ATR, el movimiento de un día normal lo puede tocar" : pct < STOP_CERCA_PCT ? "pegado al stop: a menos de 1%" : null;
  return { pct, enAtr, texto, aviso };
}

/**
 * Nombre del stop en la cabecera y en el gráfico. Una fila del Radar sin objetivo no se puede ejecutar (bajo el stop, o
 * con el stop dentro de la franja): su stop es el DINÁMICO de seguimiento, no uno de compra. El 15/9 NVDA en OBSERVAR
 * mostraba "stop de compra" en una línea que estaba arriba del precio. Con posición, es el stop de la posición.
 */
export function rotuloDelStop(i: { desde: "Radar" | "Cartera" | null; target: number | null | undefined }): string {
  if (i.desde !== "Radar") return "stop";
  return i.target === null || i.target === undefined ? "stop dinámico" : "stop de compra";
}

/**
 * Contra qué cierre se mide el cambio del día de la cabecera (15/9). Había dos "cierres de ayer": el de Alpaca IEX
 * (TSM 418,60) en la cabecera y el de Yahoo guardado (418,01) en las velas, el Radar y Cartera. El servidor ahora mide
 * contra el guardado y manda su fecha; sin fecha, es el de la fuente porque el de la sesión anterior no está guardado.
 */
export function baseDelDia(prevCloseDate: string | null | undefined): string {
  if (!prevCloseDate) return "contra el cierre previo de la fuente (todavía no guardado)";
  const [, m, d] = prevCloseDate.split("-");
  return `contra el cierre del ${Number(d)}/${Number(m)}`;
}

/** Cambio del período del gráfico, con su base escrita (15/9). */
export interface PeriodChange { label: string; change: number; changePercent: number; base: number; baseTexto: string }

const fechaUTC = (sec: number) => { const d = new Date(sec * 1000); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
const fechaHoraAR = (sec: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return `${p["day"]}/${p["month"]} a las ${p["hour"]}:${p["minute"]}`;
};

/**
 * Cambio del período (1M, 3M, 1A…) con su base. El 15/9 la ficha de APH decía "1M: −7,22%" medido desde la APERTURA
 * del 17/8, sin decirlo; el Radar y Cartera miden cierre contra cierre. Ahora, en velas diarias o semanales, la base
 * es el cierre de la vela anterior a la ventana (el del 14/8), o el de la primera si no hay anterior; en intradiario,
 * la apertura de la primera barra. El texto siempre dice cuál: "desde el cierre del 14/8".
 */
export function cambioDelPeriodo(i: { bars: Array<{ time: number; open: number; close: number }>; desde: number | null; precio: number | null; label: string; intradiario: boolean }): PeriodChange | null {
  const todas = [...i.bars].sort((a, b) => a.time - b.time).filter((b, k, arr) => k === 0 || b.time !== arr[k - 1]!.time);
  let ventana = i.desde === null ? todas : todas.filter((b) => b.time >= i.desde!);
  if (ventana.length < 2) ventana = todas;
  if (ventana.length < 2) return null;
  const primera = ventana[0]!;
  const last = i.precio ?? ventana[ventana.length - 1]!.close;
  let base: number;
  let baseTexto: string;
  if (i.intradiario) {
    base = primera.open;
    baseTexto = `desde la apertura del ${fechaHoraAR(primera.time)}`;
  } else {
    const anterior = todas[todas.indexOf(primera) - 1];
    const ref = anterior ?? primera;
    base = ref.close;
    baseTexto = `desde el cierre del ${fechaUTC(ref.time)}`;
  }
  return { label: i.label, change: last - base, changePercent: ((last - base) / base) * 100, base, baseTexto };
}

/**
 * La última vela del diario puede ser la sesión en curso, armada con el intradiario (`partial`). Se dibuja
 * apagada y el gráfico lo dice: no cerró, y las medias y el stop no se calculan sobre ella.
 */
export function notaVelaParcial(bars: Array<{ time: number; partial?: boolean }>): string | null {
  const ultima = bars.at(-1);
  if (!ultima?.partial) return null;
  const d = new Date(ultima.time * 1000);
  return `La última vela (${d.getUTCDate()}/${d.getUTCMonth() + 1}) es la sesión en curso, armada con el intradiario: todavía no cerró o no se guardó. Las medias y el stop se calculan con velas cerradas, así que ahí no se dibujan.`;
}
