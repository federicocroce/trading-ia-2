export interface Thesis {
  id: string;
  ticker: string;
  eventType: string;
  eventDate: string | null;
  direction: "long" | "short";
  pEstimate: number;
  pMarket: number;
  edge: number;
  instrument: "stock" | "call" | "put";
  entryMax: number;
  target: number;
  invalidation: string;
  confidence: string;
  reasoning: string;
  sources: string[];
  status: string;
  rejectionReason: string | null;
  promptVersion: string;
  createdAt: string;
}

export interface Position { symbol: string; quantity: number; avgCost: number; currency: string; market: "us" | "adr" | "ar"; layer: "riesgo" | "nucleo" | "cobertura"; notes: string | null }
export type Verb = "VENDER" | "REVISAR" | "MANTENER" | "SUMAR";
export interface Verdict { verdictDate: string; symbol: string; verb: Verb; reason: string; narrative: string | null; warning: string | null; close: number; spot: number | null; stop: number | null; target: number | null; gainPct: number; weightPct: number; spyClose: number | null; degradedBy: string | null }
export interface RiskReport {
  totalValue: number;
  weights: Array<{ symbol: string; value: number; weightPct: number }>;
  concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; hhiCountry: number; hhiIndustry: number; warnings: string[] };
  correlatedPairs: Array<{ a: string; b: string; corr: number }>;
  betas: Record<string, number | null>;
  portfolioBeta: number | null;
  stressSpyMinus20Pct: number | null;
  liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>;
  notes: string[];
}
interface Bucket { n: number; hitRate: number | null; avgAlpha: number | null }
export interface Measurement { total: number; pending: number; byVerb: Record<Verb, { h7: Bucket; h30: Bucket }> }
export interface CarteraRun { date: string; verdicts: Verdict[]; risk: RiskReport; errors: Array<{ symbol: string; error: string }>; measured: { measured7: number; measured30: number } }

const base = "/api";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, { headers: { "Content-Type": "application/json" }, ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; detail?: string; reason?: string };
  if (!res.ok) throw new Error(body.detail ? `${body.reason}: ${body.detail}` : JSON.stringify(body.error ?? body));
  return body;
}

export const api = {
  health: () => j<{ ok: boolean; killSwitch: boolean; lastRun: { at: string; summary: Record<string, unknown> } | null }>("/health"),
  theses: (status: string) => j<Thesis[]>(`/theses?status=${status}`),
  thesis: (id: string) => j<{ thesis: Thesis; event: { title: string; source: string; payload: Record<string, unknown> } | null; orders: Array<{ side: string; qty: number; limitPrice: number; status: string; avgFillPrice: number | null; symbol: string }> }>(`/theses/${id}`),
  approve: (id: string) => j<{ ok: boolean }>(`/theses/${id}/approve`, { method: "POST" }),
  reject: (id: string, note: string) => j<{ ok: boolean }>(`/theses/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  close: (id: string, body: { predictedOutcomeHappened: boolean; closeReason: string; notes?: string }) => j<unknown>(`/theses/${id}/close`, { method: "POST", body: JSON.stringify(body) }),
  portfolio: () => j<{ snapshot: { capitalUsd: number; dailyPnlUsd: number; killSwitch: boolean; openByEventType: Record<string, number> }; account: { equity: number } }>("/portfolio"),
  killSwitch: (on: boolean) => j<{ killSwitch: boolean }>("/kill-switch", { method: "POST", body: JSON.stringify({ on }) }),
  run: () => j<{ proposed: unknown[]; rejected: unknown[]; errors: unknown[]; newEvents: number; passed: number }>("/run", { method: "POST" }),
  cartera: {
    positions: () => j<Position[]>("/cartera/positions"),
    upsertPosition: (p: Position) => j<{ ok: boolean }>("/cartera/positions", { method: "POST", body: JSON.stringify(p) }),
    deletePosition: (symbol: string) => j<{ ok: boolean }>(`/cartera/positions/${symbol}`, { method: "DELETE" }),
    run: () => j<CarteraRun>("/cartera/run", { method: "POST" }),
    verdicts: () => j<Verdict[]>("/cartera/verdicts"),
    risk: () => j<{ date: string; report: RiskReport } | null>("/cartera/risk"),
    measurement: () => j<Measurement>("/cartera/measurement"),
  },
  calibration: () =>
    j<{
      closed: number; brierSystem: number; brierMarket: number; hitRate: number; avgPnlPct: number; totalPnlUsd: number; maxDrawdownPct: number; humanRejected: number;
      byEventType: Record<string, { n: number; hitRate: number; avgPnlPct: number; brierSystem: number; brierMarket: number }>;
      criteria: Record<string, boolean>;
    }>("/calibration"),
};
