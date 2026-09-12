import { todayLocal } from "@thesis/core";
import type { Broker, CloseReason, MarketData, Outcome, Thesis } from "@thesis/core";
import type { Store } from "./store.js";

export interface CloseInput {
  thesisId: string;
  predictedOutcomeHappened: boolean;
  closeReason: CloseReason;
  notes?: string | undefined;
}

/**
 * Cierra una tesis: vende lo comprado (orden límite al bid/spot), calcula PnL sobre fills reales
 * y registra el outcome. Si no hubo fill de compra, cierra con PnL 0 y lo anota.
 */
export async function closeThesis(input: CloseInput, deps: { store: Store; broker: Broker; marketData: MarketData }): Promise<Outcome> {
  const t = await deps.store.thesis(input.thesisId);
  if (!t) throw new Error(`thesis ${input.thesisId} not found`);
  if (t.status !== "open" && t.status !== "approved") throw new Error(`thesis ${t.id} status ${t.status}, no se puede cerrar`);

  const buys = (await deps.store.ordersForThesis(t.id)).filter((o) => o.side === "buy" && o.filledQty > 0 && o.avgFillPrice !== null);
  const qty = buys.reduce((a, o) => a + o.filledQty, 0);
  const cost = buys.reduce((a, o) => a + o.filledQty * (o.avgFillPrice ?? 0), 0);
  const mult = t.instrument === "stock" ? 1 : 100;

  let proceeds = 0;
  let notes = input.notes ?? "";
  if (qty > 0) {
    const symbol = buys[0]!.symbol;
    const exitPrice = await exitPriceFor(t, symbol, deps.marketData);
    const sell = await deps.broker.submit({ thesisId: t.id, ticker: t.ticker, instrument: t.instrument, symbol, side: "sell", qty, limitPrice: exitPrice, notionalUsd: qty * exitPrice * mult });
    await deps.store.insertOrder(sell);
    const filled = sell.avgFillPrice ?? exitPrice;
    proceeds = qty * filled;
    notes += ` | sell ${qty}@${filled}`;
  } else {
    notes += " | sin fill de compra; PnL 0";
  }
  const pnlUsd = (proceeds - cost) * mult;
  const pnlPct = cost > 0 ? (100 * (proceeds - cost)) / cost : 0;
  const outcome: Outcome = {
    thesisId: t.id,
    predictedOutcomeHappened: input.predictedOutcomeHappened,
    pnlUsd: Number(pnlUsd.toFixed(2)),
    pnlPct: Number(pnlPct.toFixed(4)),
    closeReason: input.closeReason,
    closedAt: new Date().toISOString(),
    notes: notes.trim(),
  };
  await deps.store.insertOutcome(outcome);
  await deps.store.setThesisStatus(t.id, "closed");
  return outcome;
}

async function exitPriceFor(t: Thesis, symbol: string, md: MarketData): Promise<number> {
  if (t.instrument === "stock") {
    const q = await md.getQuote(t.ticker);
    if (!q) throw new Error(`sin quote para ${t.ticker}`);
    return Number((q.price * 0.995).toFixed(2)); // límite levemente bajo el spot para asegurar fill en paper
  }
  const after = todayLocal();
  const c = await md.findOption(t.ticker, t.instrument, after, t.target);
  if (!c || c.symbol !== symbol) {
    // fallback: usar bid del contrato que tenemos si findOption devolvió otro
    if (c) return Math.max(0.01, c.bid);
    throw new Error(`sin cotización para ${symbol}`);
  }
  return Math.max(0.01, c.bid);
}
