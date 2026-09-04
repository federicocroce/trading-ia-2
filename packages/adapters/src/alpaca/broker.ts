import type { Broker, Order, OrderIntent } from "@thesis/core";
import { randomUUID } from "node:crypto";
import { alpacaHeaders, alpacaTradingBase, type AlpacaConfig, type TradingHttp } from "./client.js";

interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  status: string;
  submitted_at: string | null;
  filled_at: string | null;
  limit_price: string | null;
}

const STATUS: Record<string, Order["status"]> = {
  new: "submitted",
  accepted: "submitted",
  pending_new: "submitted",
  partially_filled: "partially_filled",
  filled: "filled",
  canceled: "cancelled",
  expired: "cancelled",
  rejected: "rejected",
};

/**
 * Broker Alpaca. Se construye SOLO con paper=true en v1: el constructor lanza si no.
 * Cada orden lleva client_order_id = thesisId:uuid para trazabilidad.
 */
export class AlpacaBroker implements Broker {
  readonly paper: boolean;
  private readonly base: string;

  constructor(
    private readonly http: TradingHttp,
    private readonly cfg: AlpacaConfig,
  ) {
    if (!cfg.paper) throw new Error("AlpacaBroker: v1 solo permite paper=true (DESIGN.md §2)");
    this.paper = true;
    this.base = alpacaTradingBase(true);
  }

  private get h() {
    return alpacaHeaders(this.cfg);
  }

  async submit(intent: OrderIntent): Promise<Order> {
    const clientId = `${intent.thesisId}:${randomUUID().slice(0, 8)}`;
    const body = {
      symbol: intent.symbol,
      qty: String(intent.qty),
      side: intent.side,
      type: "limit",
      limit_price: String(intent.limitPrice),
      time_in_force: "day",
      client_order_id: clientId,
    };
    const res = await this.http.postJson<AlpacaOrder>(`${this.base}/v2/orders`, body, this.h);
    return toOrder(intent, res);
  }

  async getOrder(brokerOrderId: string): Promise<Order> {
    const res = await this.http.getJson<AlpacaOrder>(`${this.base}/v2/orders/${brokerOrderId}`, this.h);
    const [thesisId] = res.client_order_id.split(":");
    const intent: OrderIntent = {
      thesisId: thesisId ?? "",
      ticker: res.symbol,
      instrument: /\d{6}[CP]\d{8}$/.test(res.symbol) ? (res.symbol.includes("C0") ? "call" : "put") : "stock",
      symbol: res.symbol,
      side: "buy",
      qty: Number(res.qty),
      limitPrice: Number(res.limit_price ?? 0),
      notionalUsd: Number(res.qty) * Number(res.limit_price ?? 0),
    };
    return toOrder(intent, res);
  }

  async cancel(brokerOrderId: string): Promise<void> {
    await this.http.delete(`${this.base}/v2/orders/${brokerOrderId}`, this.h);
  }

  /** Posiciones abiertas, para reconstruir PortfolioSnapshot. */
  async positions(): Promise<Array<{ symbol: string; qty: number; marketValue: number; unrealizedPl: number }>> {
    const res = await this.http.getJson<Array<{ symbol: string; qty: string; market_value: string; unrealized_pl: string }>>(`${this.base}/v2/positions`, this.h);
    return res.map((p) => ({ symbol: p.symbol, qty: Number(p.qty), marketValue: Number(p.market_value), unrealizedPl: Number(p.unrealized_pl) }));
  }

  async account(): Promise<{ equity: number; cash: number; lastEquity: number }> {
    const a = await this.http.getJson<{ equity: string; cash: string; last_equity: string }>(`${this.base}/v2/account`, this.h);
    return { equity: Number(a.equity), cash: Number(a.cash), lastEquity: Number(a.last_equity) };
  }
}

export function toOrder(intent: OrderIntent, a: AlpacaOrder): Order {
  return {
    ...intent,
    id: randomUUID(),
    brokerOrderId: a.id,
    status: STATUS[a.status] ?? "pending",
    filledQty: Number(a.filled_qty ?? 0),
    avgFillPrice: a.filled_avg_price ? Number(a.filled_avg_price) : null,
    submittedAt: a.submitted_at,
    filledAt: a.filled_at,
  };
}
