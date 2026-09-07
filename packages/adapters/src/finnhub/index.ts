import type { FinnhubMetrics, Fundamentals, NewsItem, Profiles, SymbolProfile } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { RateLimiter } from "../ratelimit.js";

interface Profile2 {
  name?: string;
  country?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
  currency?: string;
  shareOutstanding?: number;
}
const BASE = "https://finnhub.io/api/v1";
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

function toProfile(sym: string, p: Profile2): SymbolProfile | null {
  if (!p || !Object.keys(p).length) return null;
  return { symbol: sym, name: p.name ?? null, country: p.country ?? null, industry: p.finnhubIndustry ?? null, marketCap: p.marketCapitalization ? Math.round(p.marketCapitalization * 1e6) : null, currency: p.currency ?? null, shareOutstanding: p.shareOutstanding ?? null };
}

/** Perfil de empresa (país, industria, capitalización). Free tier: 60 req/min. */
export class FinnhubProfiles implements Profiles {
  constructor(
    private readonly http: HttpClient,
    private readonly token: string,
  ) {}
  async profile(symbol: string): Promise<SymbolProfile | null> {
    const sym = symbol.toUpperCase();
    return toProfile(sym, await this.http.getJson<Profile2>(`${BASE}/stock/profile2?symbol=${sym}&token=${this.token}`));
  }
}

/** Sin key de Finnhub: nunca hay perfil; el país sale del mercado de la posición. */
export const NO_PROFILES: Profiles = { profile: async () => null };

/**
 * Fundamentals para el Radar (spec etapa 2 §3), con limitador de llamadas por minuto.
 * Métricas de ADRs vienen en moneda local: los ratios sirven; los montos no (se calculan en USD aparte).
 */
export class FinnhubFundamentals implements Profiles {
  constructor(
    private readonly http: HttpClient,
    private readonly token: string,
    private readonly limiter: RateLimiter = new RateLimiter(55),
  ) {}
  private async get<T>(path: string): Promise<T> {
    await this.limiter.acquire();
    return this.http.getJson<T>(`${BASE}/${path}${path.includes("?") ? "&" : "?"}token=${this.token}`);
  }
  async profile(symbol: string): Promise<SymbolProfile | null> {
    const sym = symbol.toUpperCase();
    return toProfile(sym, await this.get<Profile2>(`stock/profile2?symbol=${sym}`));
  }
  async metrics(symbol: string): Promise<FinnhubMetrics | null> {
    const r = await this.get<{ metric?: FinnhubMetrics }>(`stock/metric?symbol=${symbol.toUpperCase()}&metric=all`);
    const m = r?.metric;
    return m && Object.keys(m).length ? m : null;
  }
  async peers(symbol: string): Promise<string[]> {
    const sym = symbol.toUpperCase();
    const r = await this.get<string[]>(`stock/peers?symbol=${sym}`);
    return (Array.isArray(r) ? r : []).filter((p) => p.toUpperCase() !== sym);
  }
  async recommendation(symbol: string): Promise<Fundamentals["analyst"]> {
    const r = await this.get<Array<{ period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }>>(`stock/recommendation?symbol=${symbol.toUpperCase()}`);
    if (!Array.isArray(r) || !r.length) return null;
    const latest = [...r].sort((a, b) => b.period.localeCompare(a.period))[0]!;
    return { strongBuy: latest.strongBuy, buy: latest.buy, hold: latest.hold, sell: latest.sell, strongSell: latest.strongSell, period: latest.period };
  }
  async earningsSurprises(symbol: string): Promise<Fundamentals["earningsSurprises"]> {
    const r = await this.get<Array<{ period: string; surprisePercent: number | null }>>(`stock/earnings?symbol=${symbol.toUpperCase()}`);
    if (!Array.isArray(r) || !r.length) return null;
    return [...r].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 4).map((s) => ({ period: s.period, surprisePercent: s.surprisePercent ?? null }));
  }
  /** Compras (P) y ventas (S) en mercado abierto dentro de la ventana. */
  async insiders(symbol: string, days: number, today: string): Promise<{ buys: number; sells: number }> {
    const r = await this.get<{ data?: Array<{ transactionCode?: string; transactionDate?: string }> }>(`stock/insider-transactions?symbol=${symbol.toUpperCase()}`);
    const since = addDays(today, -days);
    let buys = 0;
    let sells = 0;
    for (const t of r?.data ?? []) {
      if (!t.transactionDate || t.transactionDate < since || t.transactionDate > today) continue;
      if (t.transactionCode === "P") buys++;
      else if (t.transactionCode === "S") sells++;
    }
    return { buys, sells };
  }
  /** Noticias de empresa (free). Fecha desde epoch segundos; fuente vacía → null. */
  async companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> {
    const sym = symbol.toUpperCase();
    const r = await this.get<Array<{ datetime?: number; headline?: string; source?: string; url?: string; summary?: string }>>(`company-news?symbol=${sym}&from=${from}&to=${to}`);
    return (Array.isArray(r) ? r : [])
      .filter((n) => n.headline && n.url && n.datetime)
      .map((n) => ({ symbol: sym, date: new Date(n.datetime! * 1000).toISOString().slice(0, 10), headline: n.headline!, source: n.source?.trim() || null, url: n.url!, summary: n.summary?.trim() || null }));
  }
  async nextEarnings(symbol: string, today: string): Promise<string | null> {
    const r = await this.get<{ earningsCalendar?: Array<{ date: string; symbol: string }> }>(`calendar/earnings?from=${today}&to=${addDays(today, 120)}&symbol=${symbol.toUpperCase()}`);
    const dates = (r?.earningsCalendar ?? []).map((e) => e.date).filter((d) => d >= today).sort();
    return dates[0] ?? null;
  }
}
