import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { UsageCall, UsageCallInput, UsageRecorder, UsageResult } from "@thesis/core";

/** Lo que el registrador necesita de la persistencia (lo implementan Repo y MemoryStore). */
export interface UsageStore {
  insertCalls(rows: UsageCall[]): Promise<void>;
  setCallResult(id: string, result: UsageResult): Promise<void>;
}

/**
 * Contexto de uso: qué paso del pipeline (o "api" / "precios") está corriendo, para que cada pedido
 * saliente quede atribuido sin pasar el paso a mano por todas las capas. Se propaga por AsyncLocalStorage.
 */
export interface UsageContext {
  step: string;
  purpose?: string;
  symbol?: string;
}
const als = new AsyncLocalStorage<UsageContext>();

export function withUsageStep<T>(ctx: UsageContext, fn: () => T): T {
  return als.run(ctx, fn);
}
export function currentUsage(): UsageContext | undefined {
  return als.getStore();
}

export interface StoreUsageRecorderOptions {
  /** Cada cuánto se vuelca la cola a la base. */
  flushMs?: number;
  /** Se vuelca antes si la cola llega a este tamaño. */
  maxQueue?: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

/**
 * Registrador que escribe en el store por lotes. `record` es sincrónico (nunca frena un pedido HTTP):
 * encola y vuelve. `setResult` corrige en memoria si la fila todavía no se escribió, o en la base si ya se fue.
 */
export class StoreUsageRecorder implements UsageRecorder {
  private queue: UsageCall[] = [];
  private readonly pending = new Map<string, UsageCall>();
  private timer: NodeJS.Timeout | null = null;
  private readonly flushMs: number;
  private readonly maxQueue: number;
  private readonly log: (msg: string) => void;
  private readonly now: () => Date;

  constructor(
    private readonly store: UsageStore,
    opts: StoreUsageRecorderOptions = {},
  ) {
    this.flushMs = opts.flushMs ?? 1000;
    this.maxQueue = opts.maxQueue ?? 50;
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? (() => new Date());
  }

  record(call: UsageCallInput): string {
    const ctx = currentUsage();
    const row: UsageCall = {
      id: call.id ?? randomUUID(),
      at: call.at ?? this.now().toISOString(),
      source: call.source,
      step: call.step ?? ctx?.step ?? "api",
      purpose: call.purpose ?? ctx?.purpose ?? null,
      symbol: call.symbol ?? ctx?.symbol ?? null,
      endpoint: call.endpoint,
      model: call.model ?? null,
      keyIndex: call.keyIndex ?? null,
      status: call.status ?? null,
      result: call.result,
      tokensIn: call.tokensIn ?? null,
      tokensOut: call.tokensOut ?? null,
      tokensThink: call.tokensThink ?? null,
      ms: call.ms,
    };
    this.queue.push(row);
    this.pending.set(row.id, row);
    if (this.queue.length >= this.maxQueue) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
      this.timer.unref?.();
    }
    return row.id;
  }

  setResult(id: string, result: UsageResult): void {
    const row = this.pending.get(id);
    if (row) {
      row.result = result;
      return;
    }
    this.store.setCallResult(id, result).catch((e: unknown) => this.log(`[uso] no se pudo marcar ${id}: ${String(e)}`));
  }

  /** Vuelca la cola. Lo que cambió de resultado mientras se escribía se corrige después. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const rows = this.queue;
    this.queue = [];
    if (!rows.length) return;
    const snapshot = rows.map((r) => ({ ...r }));
    try {
      await this.store.insertCalls(snapshot);
      for (const r of rows) if (r.result !== snapshot.find((s) => s.id === r.id)!.result) await this.store.setCallResult(r.id, r.result);
    } catch (e) {
      this.log(`[uso] no se pudo escribir el registro (${rows.length} filas): ${String(e)}`);
    } finally {
      for (const r of rows) this.pending.delete(r.id);
    }
  }

  get queued(): number {
    return this.queue.length;
  }
}
