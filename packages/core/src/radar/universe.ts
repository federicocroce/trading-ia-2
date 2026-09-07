import type { RadarPolicy } from "./types.js";

/** Filtros del universo (spec etapa 2 §4). Fail-closed: sin dato, no pasa. */
export interface AssetInfo {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
}
export interface SnapshotLite {
  symbol: string;
  price: number | null;
  /** Volumen del día en el feed IEX (≈ 10% del consolidado). */
  iexVolume: number | null;
}
export type FinnhubMetrics = Record<string, number | null | undefined>;
export interface FundamentalsInput {
  profile: { shareOutstanding: number | null; currency: string | null; country: string | null; industry: string | null; name: string | null };
  metrics: FinnhubMetrics;
  priceUsd: number;
}

const EXCHANGES = new Set(["NYSE", "NASDAQ", "ARCA", "AMEX", "BATS"]);
const NOT_COMMON = /\b(warrants?|units?|rights?|preferred)\b/i;
/** Fondos y fideicomisos listados como acciones: no tienen fundamentals de empresa. Los REITs ("… Trust") sí son empresas. */
const FUND_LIKE = /\b(etfs?|etns?|fund|funds|grayscale|ishares|spdr|vanguard|invesco|proshares|direxion|wisdomtree|bitcoin trust|ethereum trust|gold shares|silver trust)\b/i;

export function isEligibleAsset(a: AssetInfo): { ok: boolean; reason?: string } {
  if (!a.tradable) return { ok: false, reason: "no operable" };
  if (!EXCHANGES.has(a.exchange)) return { ok: false, reason: `exchange ${a.exchange}` };
  if (!/^[A-Z]{1,5}$/.test(a.symbol)) return { ok: false, reason: "símbolo con clase o sufijo" };
  const m = NOT_COMMON.exec(a.name);
  if (m) return { ok: false, reason: `no es acción común (${m[0].toLowerCase()})` };
  const f = FUND_LIKE.exec(a.name);
  if (f) return { ok: false, reason: `fondo o fideicomiso (${f[0].toLowerCase()})` };
  return { ok: true };
}

export function passesPreFilter(s: SnapshotLite, p: RadarPolicy["prefilter"]): { ok: boolean; reason?: string } {
  if (s.price === null || s.iexVolume === null) return { ok: false, reason: "sin precio o volumen" };
  if (s.price < p.minPrice) return { ok: false, reason: `precio ${s.price} < ${p.minPrice}` };
  const dollar = s.price * s.iexVolume;
  if (dollar < p.minIexDollarVolume) return { ok: false, reason: `volumen IEX ${Math.round(dollar)} USD < ${p.minIexDollarVolume}` };
  return { ok: true };
}

/** Capitalización en USD desde acciones en circulación (millones) y precio USD. Nunca la de Finnhub (moneda local en ADRs). */
export function mcapUsd(shareOutstandingMillions: number | null | undefined, priceUsd: number): number | null {
  if (!shareOutstandingMillions || shareOutstandingMillions <= 0) return null;
  return Math.round(shareOutstandingMillions * 1e6 * priceUsd);
}
export function dollarVolumeUsd(avgVol3mMillions: number | null | undefined, priceUsd: number): number | null {
  if (!avgVol3mMillions || avgVol3mMillions <= 0) return null;
  return Math.round(avgVol3mMillions * 1e6 * priceUsd);
}

/**
 * Opciones para ADRs (Finnhub los mapea a su listado local): el volumen puede venir de Yahoo
 * (consolidado US) y la capitalización puede quedar desconocida (la relación del ADR no se conoce).
 */
export interface QualityBarOptions {
  volumeOverrideUsd?: number | null;
  allowUnknownMcap?: boolean;
}
export function qualityBar(f: FundamentalsInput, q: RadarPolicy["quality"], o: QualityBarOptions = {}): { ok: boolean; reason?: string; mcapUsd: number | null; dollarVolumeUsd: number | null } {
  const mcap = o.allowUnknownMcap ? null : mcapUsd(f.profile.shareOutstanding, f.priceUsd);
  const vol = dollarVolumeUsd(f.metrics["3MonthAverageTradingVolume"], f.priceUsd) ?? (o.volumeOverrideUsd && o.volumeOverrideUsd > 0 ? Math.round(o.volumeOverrideUsd) : null);
  if (f.priceUsd < q.minPrice) return { ok: false, reason: `precio ${f.priceUsd} < ${q.minPrice}`, mcapUsd: mcap, dollarVolumeUsd: vol };
  if (mcap === null && !o.allowUnknownMcap) return { ok: false, reason: "sin acciones en circulación", mcapUsd: null, dollarVolumeUsd: vol };
  if (vol === null) return { ok: false, reason: "sin volumen de 3 meses", mcapUsd: mcap, dollarVolumeUsd: null };
  if (mcap !== null && mcap < q.minMcapUsd) return { ok: false, reason: `capitalización ${Math.round(mcap / 1e6)}M < ${q.minMcapUsd / 1e6}M`, mcapUsd: mcap, dollarVolumeUsd: vol };
  if (vol < q.minDollarVolumeUsd) return { ok: false, reason: `volumen ${Math.round(vol / 1e6)}M/día < ${q.minDollarVolumeUsd / 1e6}M`, mcapUsd: mcap, dollarVolumeUsd: vol };
  return { ok: true, mcapUsd: mcap, dollarVolumeUsd: vol };
}
