import type { ImpliedMove, MarketData, OptionContractQuote, Quote } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { ALPACA_DATA, alpacaHeaders, type AlpacaConfig } from "./client.js";

interface Snapshot {
  latestTrade?: { p: number; t: string };
  dailyBar?: { c: number; v: number; t: string };
}
interface BarsResp {
  bars: Record<string, Array<{ c: number; v: number; t: string }>>;
}
interface OptionSnapshots {
  snapshots: Record<string, { latestQuote?: { bp: number; ap: number } }>;
  next_page_token?: string | null;
}

/** Parsea símbolo OCC: AAPL261218C00150000 -> {exp, type, strike}. */
export function parseOcc(symbol: string): { underlying: string; expiration: string; type: "call" | "put"; strike: number } | null {
  const m = /^([A-Z.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol);
  if (!m) return null;
  return {
    underlying: m[1]!,
    expiration: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5] === "C" ? "call" : "put",
    strike: Number(m[6]) / 1000,
  };
}

export class AlpacaMarketData implements MarketData {
  constructor(
    private readonly http: HttpClient,
    private readonly cfg: AlpacaConfig,
  ) {}

  private get h() {
    return alpacaHeaders(this.cfg);
  }

  async getQuote(ticker: string): Promise<Quote | null> {
    const sym = ticker.toUpperCase();
    const snaps = await this.http.getJson<Record<string, Snapshot>>(`${ALPACA_DATA}/v2/stocks/snapshots?symbols=${sym}&feed=iex`, this.h);
    const s = snaps[sym];
    const price = s?.latestTrade?.p ?? s?.dailyBar?.c;
    if (!price) return null;
    let avgVolume30d: number | null = null;
    try {
      const start = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
      const bars = await this.http.getJson<BarsResp>(`${ALPACA_DATA}/v2/stocks/bars?symbols=${sym}&timeframe=1Day&start=${start}&limit=30&feed=iex`, this.h);
      const arr = bars.bars[sym] ?? [];
      if (arr.length) avgVolume30d = Math.round(arr.reduce((a, b) => a + b.v, 0) / arr.length);
    } catch {
      /* volumen opcional */
    }
    return { ticker: sym, price, asOf: s?.latestTrade?.t ?? s?.dailyBar?.t ?? new Date().toISOString(), avgVolume30d };
  }

  private async chain(ticker: string, afterDate: string): Promise<OptionContractQuote[]> {
    const sym = ticker.toUpperCase();
    const out: OptionContractQuote[] = [];
    let token: string | null | undefined = undefined;
    do {
      const url =
        `${ALPACA_DATA}/v1beta1/options/snapshots/${sym}?feed=indicative&limit=1000&expiration_date_gte=${afterDate}` +
        (token ? `&page_token=${token}` : "");
      const res: OptionSnapshots = await this.http.getJson<OptionSnapshots>(url, this.h);
      for (const [occ, snap] of Object.entries(res.snapshots)) {
        const p = parseOcc(occ);
        const q = snap.latestQuote;
        if (!p || !q) continue;
        out.push({ symbol: occ, strike: p.strike, expiration: p.expiration, type: p.type, bid: q.bp, ask: q.ap, mid: (q.bp + q.ap) / 2 });
      }
      token = res.next_page_token;
    } while (token);
    return out;
  }

  async getImpliedMove(ticker: string, eventDate: string): Promise<ImpliedMove | null> {
    const quote = await this.getQuote(ticker);
    if (!quote) return null;
    const chain = await this.chain(ticker, eventDate);
    return impliedMoveFromChain(ticker, quote.price, chain);
  }

  async findOption(ticker: string, type: "call" | "put", afterDate: string, strike?: number): Promise<OptionContractQuote | null> {
    const quote = await this.getQuote(ticker);
    if (!quote) return null;
    const chain = await this.chain(ticker, afterDate);
    const exps = [...new Set(chain.map((c) => c.expiration))].sort();
    const exp = exps[0];
    if (!exp) return null;
    const target = strike ?? quote.price;
    const cands = chain.filter((c) => c.expiration === exp && c.type === type && c.ask > 0);
    cands.sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target));
    return cands[0] ?? null;
  }
}

/** Straddle ATM del vencimiento más cercano (ya filtrado a >= eventDate). Puro, testeable. */
export function impliedMoveFromChain(ticker: string, spot: number, chain: OptionContractQuote[]): ImpliedMove | null {
  const exps = [...new Set(chain.map((c) => c.expiration))].sort();
  const exp = exps[0];
  if (!exp) return null;
  const atExp = chain.filter((c) => c.expiration === exp && c.mid > 0);
  const strikes = [...new Set(atExp.map((c) => c.strike))];
  if (!strikes.length) return null;
  const atm = strikes.reduce((best, k) => (Math.abs(k - spot) < Math.abs(best - spot) ? k : best));
  const call = atExp.find((c) => c.strike === atm && c.type === "call");
  const put = atExp.find((c) => c.strike === atm && c.type === "put");
  if (!call || !put) return null;
  const straddle = call.mid + put.mid;
  return { ticker: ticker.toUpperCase(), expiration: exp, spot, straddle, impliedMovePct: straddle / spot };
}
