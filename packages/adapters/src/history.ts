import { completedCandles, marketOf } from "@thesis/core";
import type { Candle, PriceHistory } from "@thesis/core";

/** Fuente que además sabe qué sesiones listó sin precios (Yahoo). El respaldo las rellena. */
export interface GapAwarePriceHistory extends PriceHistory {
  candlesWithGaps(symbol: string, days: number): Promise<{ candles: Candle[]; gaps: string[] }>;
}
const knowsGaps = (h: PriceHistory): h is GapAwarePriceHistory => typeof (h as GapAwarePriceHistory).candlesWithGaps === "function";

/**
 * Primario (Yahoo) con respaldo (Alpaca): si el primario lanza o devuelve vacío, se usa el otro.
 *
 * Y si el primario devuelve la serie con una sesión vacía adentro, se le pide al respaldo SOLO esas fechas.
 * Hasta el 23/9/2026 esto no existía y el respaldo entraba únicamente cuando el primario fallaba entero: el
 * 22/9 Yahoo devolvió la rueda completa de EE.UU. con `close: null`, la serie terminó el 21/9 sin ruido y el
 * plan del 23/9 salió con cierres de dos días atrás (APH 80,72 cuando había cerrado a 82,86). Se rellena solo
 * el hueco, no la serie entera, porque el respaldo es IEX y sus cierres difieren del consolidado: cambiar todas
 * las velas movería medias, ATR y stops de golpe.
 */
export class FallbackPriceHistory implements PriceHistory {
  constructor(
    private readonly primary: PriceHistory,
    private readonly fallback: PriceHistory,
    private readonly log: (m: string) => void = () => {},
  ) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    try {
      const { candles, gaps } = knowsGaps(this.primary) ? await this.primary.candlesWithGaps(symbol, days) : { candles: await this.primary.candles(symbol, days), gaps: [] as string[] };
      if (candles.length) return gaps.length ? await this.fillGaps(symbol, days, candles, gaps) : candles;
      this.log(`[history] ${symbol}: primario vacío, uso respaldo`);
    } catch (e) {
      this.log(`[history] ${symbol}: primario falló (${String(e).slice(0, 80)}), uso respaldo`);
    }
    return this.fallback.candles(symbol, days);
  }

  /** Trae del respaldo únicamente las fechas que el primario listó sin precios. Si no las tiene, no hubo rueda. */
  private async fillGaps(symbol: string, days: number, candles: Candle[], gaps: string[]): Promise<Candle[]> {
    const faltan = new Set(gaps);
    let extra: Candle[];
    try {
      extra = (await this.fallback.candles(symbol, days)).filter((c) => faltan.has(c.date));
    } catch (e) {
      this.log(`[history] ${symbol}: sesiones vacías en el primario (${gaps.join(", ")}) y el respaldo falló (${String(e).slice(0, 80)}): la serie queda con el hueco`);
      return candles;
    }
    if (!extra.length) {
      this.log(`[history] ${symbol}: sesiones vacías en el primario (${gaps.join(", ")}) que el respaldo tampoco tiene: no hubo rueda`);
      return candles;
    }
    this.log(`[history] ${symbol}: relleno con el respaldo ${extra.map((c) => c.date).join(", ")}`);
    return [...candles, ...extra].sort((a, b) => a.date.localeCompare(b.date));
  }
}

/** Todos los consumidores de velas reciben solo sesiones cerradas (spec verificación §7). El reloj se inyecta para tests. */
export class CompletedSessionsHistory implements PriceHistory {
  constructor(
    private readonly inner: PriceHistory,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    return completedCandles(await this.inner.candles(symbol, days), this.now(), marketOf(symbol));
  }
}
