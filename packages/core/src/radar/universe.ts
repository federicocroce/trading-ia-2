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
  profile: { shareOutstanding: number | null; currency: string | null; country: string | null; industry: string | null; name: string | null; marketCap?: number | null };
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
/**
 * Capitalización en dólares (2026-09-13). Antes era siempre acciones en circulación × precio, y eso es falso
 * en cuanto el papel es un ADR o hubo un split que la fuente no reflejó en una de las dos puntas:
 *
 * - TSM mostraba 11,1 billones porque multiplicaba el precio del ADR (428,64) por las ordinarias taiwanesas
 *   (25.932 M). Un ADR son 5 ordinarias: la real es ~2,2 billones.
 * - HSBC mostraba 1,84 billones por lo mismo (un ADR son 5 ordinarias). La real es 268 mil millones.
 * - APH mostraba la mitad, 101,9 mil millones contra 204,1, porque las acciones eran de antes del split y el
 *   precio de después.
 *
 * El número manda decisiones: entra en el puntaje de riesgo y en el filtro de capitalización mínima del
 * universo. Ahora manda la capitalización que publica la fuente cuando viene en dólares (en NVDA coincide
 * con el cálculo al 0,2%, así que el control tiene dientes). Si la fuente la publica en otra moneda no se
 * convierte ni se inventa: queda desconocida, que es lo que ya contemplan los extranjeros.
 */
export function mcapUsd(
  shareOutstandingMillions: number | null | undefined,
  priceUsd: number,
  profile?: { marketCap?: number | null; currency?: string | null },
): number | null {
  const moneda = (profile?.currency ?? "USD").toUpperCase();
  const publicada = profile?.marketCap ?? null;
  if (publicada !== null && publicada > 0 && moneda === "USD") return Math.round(publicada);
  // En otra moneda, el producto precio × acciones tampoco sirve: el precio es del ADR y las acciones son las
  // ordinarias locales. Mejor sin dato que con uno inflado cinco veces.
  if (moneda !== "USD") return null;
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
  const mcap = o.allowUnknownMcap ? null : mcapUsd(f.profile.shareOutstanding, f.priceUsd, f.profile);
  const finnhubVol = dollarVolumeUsd(f.metrics["3MonthAverageTradingVolume"], f.priceUsd);
  const override = o.volumeOverrideUsd && o.volumeOverrideUsd > 0 ? Math.round(o.volumeOverrideUsd) : null;
  // Finnhub puede traer el volumen del listado local (ADR): se usa el mayor entre Finnhub y el consolidado US.
  const vol = finnhubVol === null ? override : override === null ? finnhubVol : Math.max(finnhubVol, override);
  if (f.priceUsd < q.minPrice) return { ok: false, reason: `precio ${f.priceUsd} < ${q.minPrice}`, mcapUsd: mcap, dollarVolumeUsd: vol };
  if (mcap === null && !o.allowUnknownMcap) {
    const moneda = (f.profile.currency ?? "USD").toUpperCase();
    const motivo = moneda === "USD" ? "sin acciones en circulación" : `capitalización publicada en ${moneda}: no se convierte ni se estima con el precio del ADR`;
    return { ok: false, reason: motivo, mcapUsd: null, dollarVolumeUsd: vol };
  }
  if (vol === null) return { ok: false, reason: "sin volumen de 3 meses", mcapUsd: mcap, dollarVolumeUsd: null };
  if (mcap !== null && mcap < q.minMcapUsd) return { ok: false, reason: `capitalización ${Math.round(mcap / 1e6)}M < ${q.minMcapUsd / 1e6}M`, mcapUsd: mcap, dollarVolumeUsd: vol };
  if (vol < q.minDollarVolumeUsd) return { ok: false, reason: `volumen ${Math.round(vol / 1e6)}M/día < ${q.minDollarVolumeUsd / 1e6}M`, mcapUsd: mcap, dollarVolumeUsd: vol };
  return { ok: true, mcapUsd: mcap, dollarVolumeUsd: vol };
}
