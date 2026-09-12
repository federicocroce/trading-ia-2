import { todayLocal } from "@thesis/core";
import type { Broker, MarketData, Order, PortfolioSnapshot, RiskDecision, RiskEngine, Thesis } from "@thesis/core";
import type { Store } from "./store.js";

export interface ExecDeps {
  store: Store;
  risk: RiskEngine;
  marketData: MarketData;
  broker: Broker;
  snapshot: () => Promise<PortfolioSnapshot>;
}

export type ExecResult = { ok: true; order: Order; thesis: Thesis } | { ok: false; reason: string; detail: string };

/** Decisión humana: aprobar. Pasa por riesgo y, si ok, manda la orden al broker (paper). */
export async function approveAndExecute(thesisId: string, deps: ExecDeps): Promise<ExecResult> {
  const thesis = await deps.store.thesis(thesisId);
  if (!thesis) return { ok: false, reason: "not_found", detail: thesisId };
  if (thesis.status !== "proposed") return { ok: false, reason: "bad_status", detail: thesis.status };

  await deps.store.setThesisStatus(thesisId, "approved", { humanDecision: "approve" });
  const approved: Thesis = { ...thesis, status: "approved" };

  // Precio de referencia: acción → spot; opción → ask del contrato ATM más cercano al target.
  let price: number | null = null;
  let symbol = thesis.ticker;
  if (thesis.instrument === "stock") {
    price = (await deps.marketData.getQuote(thesis.ticker))?.price ?? null;
  } else {
    const after = thesis.eventDate ?? todayLocal();
    const c = await deps.marketData.findOption(thesis.ticker, thesis.instrument, after, thesis.target);
    if (c) {
      price = c.ask;
      symbol = c.symbol;
    }
  }
  if (price === null) {
    await deps.store.setThesisStatus(thesisId, "rejected", { rejectionReason: "risk_rule" });
    return { ok: false, reason: "no_price", detail: "sin precio de mercado" };
  }

  const decision: RiskDecision = deps.risk.size(approved, price, await deps.snapshot());
  if (!decision.ok) {
    await deps.store.setThesisStatus(thesisId, "rejected", { rejectionReason: "risk_rule" });
    return { ok: false, reason: decision.rule, detail: decision.detail };
  }

  const order = await deps.broker.submit({ ...decision.intent, symbol });
  await deps.store.insertOrder(order);
  await deps.store.setThesisStatus(thesisId, "open");
  return { ok: true, order, thesis: { ...approved, status: "open" } };
}

/** Decisión humana: rechazar. Se registra para medir el criterio humano. */
export async function rejectByHuman(thesisId: string, store: Store, note = ""): Promise<boolean> {
  const t = await store.thesis(thesisId);
  if (!t || t.status !== "proposed") return false;
  await store.setThesisStatus(thesisId, "rejected", { rejectionReason: "human", humanDecision: `reject${note ? `: ${note}` : ""}` });
  return true;
}

/** Sincroniza órdenes abiertas con el broker. */
export async function syncOrders(store: Store, broker: Broker): Promise<number> {
  let n = 0;
  for (const o of await store.openOrders()) {
    if (!o.brokerOrderId) continue;
    const fresh = await broker.getOrder(o.brokerOrderId).catch(() => null);
    if (!fresh) continue;
    await store.updateOrder({ ...o, status: fresh.status, filledQty: fresh.filledQty, avgFillPrice: fresh.avgFillPrice, filledAt: fresh.filledAt });
    n++;
  }
  return n;
}
