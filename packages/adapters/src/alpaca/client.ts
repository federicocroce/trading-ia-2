import type { HttpClient } from "../http/index.js";

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  paper: boolean;
}

export const ALPACA_DATA = "https://data.alpaca.markets";
export const alpacaTradingBase = (paper: boolean) => (paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets");

export function alpacaHeaders(cfg: AlpacaConfig): Record<string, string> {
  return { "APCA-API-KEY-ID": cfg.keyId, "APCA-API-SECRET-KEY": cfg.secretKey };
}

/** HttpClient con POST/DELETE para trading. */
export interface TradingHttp extends HttpClient {
  postJson<T = unknown>(url: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  delete(url: string, headers?: Record<string, string>): Promise<void>;
}

export function createTradingHttp(base: HttpClient, userAgent: string, fetchFn: typeof fetch = fetch): TradingHttp {
  return {
    ...base,
    async postJson<T>(url: string, body: unknown, headers?: Record<string, string>) {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": userAgent, ...headers },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()} for POST ${url}`);
      return res.json() as Promise<T>;
    },
    async delete(url: string, headers?: Record<string, string>) {
      const res = await fetchFn(url, { method: "DELETE", headers: { "User-Agent": userAgent, ...headers } });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status} for DELETE ${url}`);
    },
  };
}
