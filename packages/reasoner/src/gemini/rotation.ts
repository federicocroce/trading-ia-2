/**
 * Rotación de modelo+key para el free tier de Gemini. Port de trading v1
 * (apps/backend/src/shared/gemini.ts + quota-tracker.ts + modelo-muerto.ts), con el estado
 * en memoria en vez de SQLite y el reloj inyectable para testear.
 *
 * Orden modelo-mayor, key-menor: la cuota del free tier es POR MODELO y por proyecto (cada key es
 * un proyecto distinto), así que dos Flash que funcionan duplican la cuota diaria en vez de competir.
 */

/**
 * - muerto: el modelo no está en el plan; una semana afuera.
 * - quota: cuota diaria agotada; afuera hasta el reinicio de Google (medianoche Pacífico).
 * - rpm: límite por minuto; se espera lo que Google indica y se reintenta la misma key una vez.
 * - retryable: saturación o red; pasa a la siguiente key y, si todas fallan, pausa el modelo 10 min.
 * - otro: no se marca nada.
 */
export type ErrorKind = "muerto" | "quota" | "rpm" | "retryable" | "otro";

/** Una semana: "este modelo no está en tu plan" no se arregla esperando a mañana. */
export const MUERTO_MS = 7 * 24 * 60 * 60 * 1000;
/** Pausa de un modelo que dio 503 con TODAS las keys: la saturación es del modelo, no de la key. */
export const RETRYABLE_COOLDOWN_MS = 10 * 60 * 1000;
/** Espera por defecto ante un 429 por minuto sin RetryInfo, y tope si Google pide más. */
export const RPM_DEFAULT_WAIT_MS = 15_000;
export const RPM_MAX_WAIT_MS = 65_000;

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

/** Error HTTP de Gemini con el detalle del 429 (por minuto o por día) y la espera que pide Google. */
export class GeminiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Solo en 429: "rpm" (por minuto o tokens por minuto) o "rpd" (cuota diaria). undefined si Google no lo dijo. */
    readonly quotaKind?: "rpm" | "rpd",
    readonly retryDelayMs?: number,
  ) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

/** Como classifyError, pero usa el detalle del 429 cuando el error lo trae. "limit: 0" sigue siendo muerto. */
export function classifyAttemptError(err: unknown): ErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  const base = classifyError(message);
  if (err instanceof GeminiHttpError && err.status === 429 && base !== "muerto") {
    if (err.quotaKind === "rpm") return "rpm";
    return "quota";
  }
  return base;
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

/** Estado de agotamiento por modelo+key. Vive lo que vive el proceso; compartirlo entre todos los llamadores. */
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
  /** Espera ante un 429 por minuto. Inyectable para testear. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Alcance del registro de agotados (15/9). Las búsquedas usan el suyo: con claves gratis los 3.x no tienen búsqueda
   * de Google, y su 429 dejaba al modelo fuera hasta la medianoche del Pacífico también para las llamadas comunes.
   */
  scope?: string;
}

/** Recorre modelo+key hasta que uno responda. Marca cuota/muerto; el 429 por minuto espera y reintenta; todo lo demás pasa al siguiente. */
export async function withRotation<T, M extends string>(o: RotationOptions<T, M>): Promise<{ result: T; model: M; keyIndex: number }> {
  const log = o.log ?? (() => {});
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastError: Error | null = null;
  let skipped = 0;
  const retryableByModel = new Map<string, number>();
  const tk = (m: string) => (o.scope ? `${o.scope}:${m}` : m);
  for (const { model, keyIndex } of attemptOrder(o.models, o.keys.length)) {
    if (o.tracker.isExhausted(tk(model), keyIndex)) {
      skipped++;
      continue;
    }
    let waited = false;
    for (;;) {
      try {
        const result = await o.attempt(model, o.keys[keyIndex]!, keyIndex);
        return { result, model, keyIndex };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const kind = classifyAttemptError(err);
        log(`[gemini] ${model} key#${keyIndex + 1} falló (${kind}): ${err.message.slice(0, 160)}`);
        if (kind === "rpm" && !waited) {
          waited = true;
          const asked = err instanceof GeminiHttpError ? err.retryDelayMs : undefined;
          const wait = Math.min(RPM_MAX_WAIT_MS, asked ?? RPM_DEFAULT_WAIT_MS);
          log(`[gemini] ${model} key#${keyIndex + 1} límite por minuto: espero ${Math.round(wait / 1000)} s y reintento la misma key`);
          await sleep(wait);
          continue;
        }
        if (kind === "muerto") o.tracker.markExhausted(tk(model), keyIndex, new Date(now() + MUERTO_MS));
        else if (kind === "quota") o.tracker.markExhausted(tk(model), keyIndex, dailyResetAt(new Date(now())));
        else if (kind === "retryable") {
          const n = (retryableByModel.get(model) ?? 0) + 1;
          retryableByModel.set(model, n);
          if (n === o.keys.length) {
            log(`[gemini] ${model} saturado con todas las keys: pausa ${RETRYABLE_COOLDOWN_MS / 60_000} min`);
            for (let k = 0; k < o.keys.length; k++) o.tracker.markExhausted(tk(model), k, new Date(now() + RETRYABLE_COOLDOWN_MS));
          }
        }
        lastError = err;
        break;
      }
    }
  }
  if (!lastError) throw new Error(`gemini: todos los modelos+keys agotados (${skipped} salteados)`);
  throw lastError;
}
