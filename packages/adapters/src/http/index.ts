/**
 * Cliente HTTP mínimo e inyectable. En tests se reemplaza por fixtures;
 * en producción usa fetch global con User-Agent (EDGAR lo exige).
 */
export interface HttpClient {
  getJson<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
  getText(url: string, headers?: Record<string, string>): Promise<string>;
}

export interface HttpOptions {
  userAgent: string;
  /** ms entre requests al mismo host (EDGAR: máx 10 req/s). */
  minIntervalMs?: number;
  timeoutMs?: number;
}

export function createHttpClient(opts: HttpOptions): HttpClient {
  const lastByHost = new Map<string, number>();
  const minInterval = opts.minIntervalMs ?? 150;
  const timeout = opts.timeoutMs ?? 20_000;

  async function throttle(url: string) {
    const host = new URL(url).host;
    const last = lastByHost.get(host) ?? 0;
    const wait = last + minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastByHost.set(host, Date.now());
  }

  async function doFetch(url: string, headers?: Record<string, string>): Promise<Response> {
    await throttle(url);
    const res = await fetch(url, {
      headers: { "User-Agent": opts.userAgent, Accept: "application/json, text/plain, */*", ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    return res;
  }

  return {
    async getJson<T>(url: string, headers?: Record<string, string>) {
      return (await doFetch(url, headers)).json() as Promise<T>;
    },
    async getText(url: string, headers?: Record<string, string>) {
      return (await doFetch(url, headers)).text();
    },
  };
}

/** Cliente de fixtures: mapea URL (o prefijo) -> respuesta. Para tests. */
export function fixtureHttpClient(fixtures: Record<string, unknown>): HttpClient {
  function lookup(url: string): unknown {
    if (url in fixtures) return fixtures[url];
    const key = Object.keys(fixtures).find((k) => url.startsWith(k));
    if (key === undefined) throw new Error(`No fixture for ${url}`);
    return fixtures[key];
  }
  return {
    async getJson<T>(url: string) {
      return lookup(url) as T;
    },
    async getText(url: string) {
      const v = lookup(url);
      return typeof v === "string" ? v : JSON.stringify(v);
    },
  };
}
