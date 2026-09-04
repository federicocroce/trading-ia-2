import type { PortfolioSnapshot, Thesis } from "@thesis/core";
import type { Store } from "./store.js";

export interface AccountView {
  equity: number;
  lastEquity: number;
}

/** Reconstruye el snapshot desde las tesis abiertas y sus órdenes (fuente de verdad: nuestra DB, no el broker). */
export async function buildSnapshot(store: Store, account: AccountView, killSwitch: boolean): Promise<PortfolioSnapshot> {
  const open = await store.thesesByStatus("open");
  const openByThesis: Record<string, number> = {};
  const openByEventType: Partial<Record<Thesis["eventType"], number>> = {};
  for (const t of open) {
    const orders = await store.ordersForThesis(t.id);
    const notional = orders.filter((o) => o.side === "buy" && o.status !== "cancelled" && o.status !== "rejected").reduce((a, o) => a + o.notionalUsd, 0);
    openByThesis[t.id] = notional;
    openByEventType[t.eventType] = (openByEventType[t.eventType] ?? 0) + notional;
  }
  return {
    capitalUsd: account.equity,
    openByThesis,
    openByEventType,
    dailyPnlUsd: account.equity - account.lastEquity,
    killSwitch,
  };
}
