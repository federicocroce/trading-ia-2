/**
 * Rotación de modelo+key para el free tier de Gemini. Port de trading v1
 * (apps/backend/src/shared/gemini.ts + quota-tracker.ts + modelo-muerto.ts), con el estado
 * en memoria en vez de SQLite y el reloj inyectable para testear.
 *
 * Orden modelo-mayor, key-menor: la cuota del free tier es POR MODELO, así que dos Flash
 * que funcionan duplican la cuota diaria en vez de competir por la misma.
 */

export type ErrorKind = "muerto" | "quota" | "retryable" | "otro";

/** Una semana: "este modelo no está en tu plan" no se arregla esperando a mañana. */
export const MUERTO_MS = 7 * 24 * 60 * 60 * 1000;

export interface Attempt<M extends string = string> {
  model: M;
  keyIndex: number;
}

export function attemptOrder<M extends string>(models: readonly M[], keyCount: number): Attempt<M>[] {
  const out: Attempt<M>[] = [];
  for (const model of models) for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) out.push({ model, keyIndex });
  return out;
}

/**
 * El orden importa: un "limit: 0" viaja como 429 y parecería cuota diaria, pero es
 * "este modelo no está en tu plan" y reintentarlo mañana tampoco sirve.
 */
export function classifyError(message: string): ErrorKind {
  const m = message.toLowerCase();
  if (
    m.includes("does not exist") ||
    m.includes("do not have access") ||
    m.includes("decommissioned") ||
    m.includes("no longer supported") ||
    m.includes("no longer available") ||
    m.includes("limit: 0")
  ) return "muerto";
  if (m.includes("429") || m.includes("quota") || m.includes("resource_exhausted") || m.includes("rate_limit")) return "quota";
  if (
    m.includes("overloaded") || m.includes("unavailable") || m.includes("high demand") ||
    m.includes("503") || m.includes("502") || m.includes("500") ||
    m.includes("fetch failed") || m.includes("network") || m.includes("timeout") ||
    m.includes("econnreset") || m.includes("etimedout")
  ) return "retryable";
  return "otro";
}

/** Próximo 00:05 hora Pacífico (las cuotas diarias de Google resetean a medianoche PT). */
export function dailyResetAt(now: Date = new Date()): Date {
  // toLocaleString descarta milisegundos: truncar antes para que el offset sea exacto.
  const base = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const ptWall = new Date(base.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const offsetMs = base.getTime() - ptWall.getTime();
  const nextMidnight = new Date(ptWall);
  nextMidnight.setHours(24, 5, 0, 0);
  return new Date(nextMidnight.getTime() + offsetMs);
}

/** Estado de agotamiento por modelo+key. Vive lo que vive el proceso. */
export class QuotaTracker {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  private key(model: string, keyIndex: number) {
    return `${model}#${keyIndex}`;
  }
  isExhausted(model: string, keyIndex: number): boolean {
    const t = this.until.get(this.key(model, keyIndex));
    if (t === undefined) return false;
    if (t <= this.now()) {
      this.until.delete(this.key(model, keyIndex));
      return false;
    }
    return true;
  }
  resetAt(model: string, keyIndex: number): number | undefined {
    return this.until.get(this.key(model, keyIndex));
  }
  markExhausted(model: string, keyIndex: number, resetAt: Date): void {
    this.until.set(this.key(model, keyIndex), resetAt.getTime());
  }
}

export interface RotationOptions<T, M extends string> {
  models: readonly M[];
  keys: readonly string[];
  tracker: QuotaTracker;
  attempt: (model: M, key: string, keyIndex: number) => Promise<T>;
  log?: (msg: string) => void;
  now?: () => number;
}

/** Recorre modelo+key hasta que uno responda. Marca cuota/muerto; todo lo demás pasa al siguiente. */
export async function withRotation<T, M extends string>(o: RotationOptions<T, M>): Promise<{ result: T; model: M; keyIndex: number }> {
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  let lastError: Error | null = null;
  let skipped = 0;
  for (const { model, keyIndex } of attemptOrder(o.models, o.keys.length)) {
    if (o.tracker.isExhausted(model, keyIndex)) {
      skipped++;
      continue;
    }
    try {
      const result = await o.attempt(model, o.keys[keyIndex]!, keyIndex);
      return { result, model, keyIndex };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const kind = classifyError(err.message);
      log(`[gemini] ${model} key#${keyIndex + 1} falló (${kind}): ${err.message.slice(0, 160)}`);
      if (kind === "muerto") o.tracker.markExhausted(model, keyIndex, new Date(now() + MUERTO_MS));
      else if (kind === "quota") o.tracker.markExhausted(model, keyIndex, dailyResetAt(new Date(now())));
      lastError = err;
    }
  }
  if (!lastError) throw new Error(`gemini: todos los modelos+keys agotados (${skipped} salteados)`);
  throw lastError;
}
