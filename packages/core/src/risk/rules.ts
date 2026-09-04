/**
 * Límites duros (DESIGN.md §3.4). Viven en código, nunca en prompts.
 * Los valores son la config por defecto; se pueden sobreescribir por env, no por LLM.
 */
export interface RiskLimits {
  /** Fracción máxima del capital por tesis. */
  maxPerThesis: number;
  /** Fracción máxima del capital por tipo de evento. */
  maxPerEventType: number;
  /** Fracción máxima del capital en prima de UNA posición de opciones. */
  maxOptionPremium: number;
  /** Pérdida diaria (fracción del capital) que pausa todo. */
  maxDailyLoss: number;
  /** Edge mínimo para que una tesis sea ejecutable. */
  minEdge: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPerThesis: 0.10,
  maxPerEventType: 0.30,
  maxOptionPremium: 0.03,
  maxDailyLoss: 0.03,
  minEdge: 0.10,
};
