import type { Profiles, SymbolProfile } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

interface Profile2 {
  name?: string;
  country?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number;
}

/** Perfil de empresa (país, industria, capitalización). Free tier: 60 req/min. */
export class FinnhubProfiles implements Profiles {
  constructor(
    private readonly http: HttpClient,
    private readonly token: string,
  ) {}
  async profile(symbol: string): Promise<SymbolProfile | null> {
    const sym = symbol.toUpperCase();
    const p = await this.http.getJson<Profile2>(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${this.token}`);
    if (!p || !Object.keys(p).length) return null;
    return { symbol: sym, name: p.name ?? null, country: p.country ?? null, industry: p.finnhubIndustry ?? null, marketCap: p.marketCapitalization ? Math.round(p.marketCapitalization * 1e6) : null };
  }
}

/** Sin key de Finnhub: nunca hay perfil; el país sale del mercado de la posición. */
export const NO_PROFILES: Profiles = { profile: async () => null };
