import { GEMINI_HOST, sourceForHost } from "./limits.js";
import type { UsageRecorder, UsageResult } from "./types.js";

export interface RecordingFetchOptions {
  /** Hosts que registran por su cuenta con más detalle (Gemini escribe tokens, modelo y clave). */
  skipHosts?: string[];
  now?: () => number;
}

function urlOf(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input);
    if (input instanceof URL) return input;
    return new URL(input.url);
  } catch {
    return null;
  }
}

/** 429 en una fuente de datos es el límite por minuto; el resto de los no-ok son error. */
export function resultForStatus(status: number): UsageResult {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429) return "rpm";
  if (status === 503 || status === 502) return "saturado";
  return "error";
}

/**
 * Envuelve `fetch` para que cada pedido saliente quede en el registro: fuente por host, path sin query
 * (las claves viajan en query o headers y no se guardan), símbolo si viene como `symbol`, estado y tiempo.
 * Los errores de red se registran con estado null y se relanzan.
 */
export function recordingFetch(recorder: UsageRecorder, impl: typeof fetch = fetch, opts: RecordingFetchOptions = {}): typeof fetch {
  const skip = new Set((opts.skipHosts ?? [GEMINI_HOST]).map((h) => h.toLowerCase()));
  const now = opts.now ?? Date.now;
  return async (input, init) => {
    const url = urlOf(input);
    if (!url || skip.has(url.host.toLowerCase())) return impl(input, init);
    const source = sourceForHost(url.host);
    const symbol = url.searchParams.get("symbol");
    const base = { source, endpoint: `${url.host}${url.pathname}`, symbol: symbol ? symbol.toUpperCase() : null };
    const t0 = now();
    try {
      const res = await impl(input, init);
      recorder.record({ ...base, status: res.status, result: resultForStatus(res.status), ms: now() - t0 });
      return res;
    } catch (e) {
      recorder.record({ ...base, status: null, result: "error", ms: now() - t0 });
      throw e;
    }
  };
}
