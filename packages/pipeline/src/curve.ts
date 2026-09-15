import { buildCurve, type Candle, type CurveReport } from "@thesis/core";
import type { CarteraStore, RadarStore } from "./store.js";

/**
 * Curva de la Cartera real: operaciones + velas guardadas + posiciones → `buildCurve`. No pide nada a la red:
 * las velas las refrescan Cartera y Radar al correr. Si falta algo, la curva lo dice (o no sale y se dice por qué).
 */
export interface CurveResponse {
  curve: CurveReport | null;
  error: string | null;
  computedAt: string;
}

/** Velas previas a la primera operación, para tener un cierre vigente aunque el primer día caiga en fin de semana. */
const LOOKBACK_DAYS = 10;
const addDays = (date: string, n: number) => new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

export async function carteraCurve(store: Pick<CarteraStore, "transactions" | "positions"> & Pick<RadarStore, "candles">): Promise<CurveResponse> {
  const computedAt = new Date().toISOString();
  const [transactions, positions] = await Promise.all([store.transactions(), store.positions()]);
  // Todas las operaciones mueven la tenencia (15/9): un traspaso es la foto del saldo y un dividendo reinvertido
  // son acciones. Hasta ese día solo se cargaban velas de los papeles con compras o ventas.
  const openers = transactions.filter((t) => t.type !== "DIVIDEND");
  if (!openers.length) return { curve: null, error: null, computedAt };
  const first = openers.map((t) => t.date).sort()[0]!;
  const symbols = [...new Set(transactions.map((t) => t.symbol.toUpperCase()))];
  const candles: Record<string, Candle[]> = {};
  await Promise.all(symbols.map(async (s) => { candles[s] = await store.candles(s, addDays(first, -LOOKBACK_DAYS)).catch(() => []); }));
  const spy = await store.candles("SPY", first).catch(() => [] as Candle[]);
  try {
    return { curve: buildCurve({ transactions, candles, spy, positions }), error: null, computedAt };
  } catch (e) {
    return { curve: null, error: e instanceof Error ? e.message : String(e), computedAt };
  }
}
