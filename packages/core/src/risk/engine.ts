import type { PortfolioSnapshot, RiskDecision, RiskEngine } from "../contracts/index.js";
import type { Thesis } from "../schemas/thesis.js";
import { DEFAULT_RISK_LIMITS, type RiskLimits } from "./rules.js";

const OPTION_MULTIPLIER = 100;

/**
 * Implementación determinística del módulo de riesgo. Sin excepciones:
 * cada regla es una función pura que devuelve el primer rechazo encontrado.
 */
export class DefaultRiskEngine implements RiskEngine {
  constructor(private readonly limits: RiskLimits = DEFAULT_RISK_LIMITS) {}

  size(thesis: Thesis, price: number, portfolio: PortfolioSnapshot): RiskDecision {
    if (portfolio.killSwitch) {
      return reject("kill_switch", "kill switch activo; no se emiten órdenes");
    }
    if (portfolio.dailyPnlUsd <= -this.limits.maxDailyLoss * portfolio.capitalUsd) {
      return reject("max_daily_loss", `pérdida diaria ${portfolio.dailyPnlUsd.toFixed(2)} supera el límite`);
    }
    if (thesis.status !== "approved") {
      return reject("not_approved", `estado ${thesis.status}; solo se ejecutan tesis aprobadas por humano`);
    }
    if (thesis.edge < this.limits.minEdge) {
      return reject("min_edge", `edge ${thesis.edge.toFixed(3)} < ${this.limits.minEdge}`);
    }
    if (!(price > 0) || price > thesis.entryMax) {
      return reject("entry_price", `precio ${price} fuera de entryMax ${thesis.entryMax}`);
    }
    if (portfolio.openByThesis[thesis.id]) {
      return reject("already_open", "la tesis ya tiene exposición abierta");
    }

    const isOption = thesis.instrument !== "stock";
    const capFraction = isOption ? this.limits.maxOptionPremium : this.limits.maxPerThesis;
    const perThesisCap = capFraction * portfolio.capitalUsd;

    const openInType = portfolio.openByEventType[thesis.eventType] ?? 0;
    const typeRoom = this.limits.maxPerEventType * portfolio.capitalUsd - openInType;
    if (typeRoom <= 0) {
      return reject("max_per_event_type", `tipo ${thesis.eventType} ya está en el límite`);
    }

    const budget = Math.min(perThesisCap, typeRoom);
    const unitCost = isOption ? price * OPTION_MULTIPLIER : price;
    const qty = Math.floor(budget / unitCost);
    if (qty < 1) {
      return reject("min_qty", `presupuesto ${budget.toFixed(2)} no alcanza para 1 unidad a ${unitCost}`);
    }

    // Apalancamiento cero: para short de acciones no se abre posición en v1.
    if (thesis.instrument === "stock" && thesis.direction === "short") {
      return reject("no_short_stock", "short de acciones deshabilitado en v1; usar put");
    }

    return {
      ok: true,
      intent: {
        thesisId: thesis.id,
        ticker: thesis.ticker,
        instrument: thesis.instrument,
        symbol: thesis.ticker, // el broker resuelve el símbolo OCC para opciones
        side: "buy",
        qty,
        limitPrice: price,
        notionalUsd: qty * unitCost,
      },
    };
  }
}

function reject(rule: string, detail: string): RiskDecision {
  return { ok: false, rule, detail };
}
