/**
 * Macro Argentina: dólares (dolarapi.com) y riesgo país (argentinadatos.com). Gratis, sin key.
 * Parsers puros; la clase solo hace el fetch.
 */
export type Dolares = Partial<Record<"oficial" | "mep" | "ccl" | "blue" | "mayorista", number>>;

const DOLARAPI_URL = "https://dolarapi.com/v1/dolares";
const RIESGO_PAIS_URL = "https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais/ultimo";
/** Nombre de dolarapi → nombre del sistema. "bolsa" es el MEP. */
const CASAS: Record<string, keyof Dolares> = { oficial: "oficial", bolsa: "mep", contadoconliqui: "ccl", blue: "blue", mayorista: "mayorista" };

/** Precio de venta por casa. Lo que no se entiende se ignora. */
export function parseDolares(body: unknown): Dolares {
  const out: Dolares = {};
  if (!Array.isArray(body)) return out;
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const { casa, venta } = item as { casa?: unknown; venta?: unknown };
    const key = typeof casa === "string" ? CASAS[casa] : undefined;
    if (key && typeof venta === "number" && Number.isFinite(venta)) out[key] = venta;
  }
  return out;
}

export function parseRiesgoPais(body: unknown): { value: number; date: string } | null {
  if (!body || typeof body !== "object") return null;
  const { valor, fecha } = body as { valor?: unknown; fecha?: unknown };
  if (typeof valor !== "number" || typeof fecha !== "string") return null;
  return { value: valor, date: fecha };
}

export class ArgentinaMacro {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  private async getJson(url: string, label: string): Promise<unknown> {
    const res = await this.fetchFn(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    return res.json();
  }
  async dolares(): Promise<Dolares> {
    return parseDolares(await this.getJson(DOLARAPI_URL, "dólares"));
  }
  async riesgoPais(): Promise<{ value: number; date: string } | null> {
    return parseRiesgoPais(await this.getJson(RIESGO_PAIS_URL, "riesgo país"));
  }
}
