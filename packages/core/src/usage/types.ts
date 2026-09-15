/**
 * Registro de uso de fuentes externas (Gemini, Finnhub, Alpaca, SEC, Yahoo…).
 * Una fila por pedido saliente: quién lo hizo (paso, propósito, símbolo), a quién (fuente, endpoint,
 * modelo, clave) y cómo terminó (estado HTTP, resultado, tokens, milisegundos). Puro: sin base ni red.
 */
export type UsageSource = "gemini" | "finnhub" | "alpaca" | "sec" | "yahoo" | "otro";

/**
 * - ok: respondió y se pudo usar.
 * - rpm: 429 por límite por minuto (se espera y se reintenta).
 * - rpd: 429 por cuota diaria (la clave queda fuera hasta el reinicio de Google).
 * - limite: 429 sin decir qué límite (15/9: búsqueda en un modelo que el plan gratis no tiene). No es cuota diaria.
 * - saturado: 503 "alta demanda" u otro transitorio del proveedor.
 * - validacion: respondió, pero la salida no pasó la validación (llamada desperdiciada).
 * - error: cualquier otra falla (red, 4xx, parseo).
 */
export type UsageResult = "ok" | "rpm" | "rpd" | "limite" | "saturado" | "validacion" | "error";

export interface UsageCall {
  id: string;
  /** ISO. */
  at: string;
  source: UsageSource;
  /** Paso del pipeline (scan, cartera, radar, argentina, plan, tesis), "precios" o "api" para pedidos interactivos. */
  step: string;
  /** Qué se pidió al modelo: ficha, eventos, narrador, tesis… null para fuentes de datos. */
  purpose: string | null;
  symbol: string | null;
  /** Path sin query ni claves; para Gemini, el modelo. */
  endpoint: string;
  model: string | null;
  /** 1..n, solo Gemini. */
  keyIndex: number | null;
  status: number | null;
  result: UsageResult;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensThink: number | null;
  ms: number;
}

export type UsageCallInput = Omit<UsageCall, "id" | "at" | "step" | "purpose" | "symbol" | "model" | "keyIndex" | "status" | "tokensIn" | "tokensOut" | "tokensThink"> &
  Partial<Pick<UsageCall, "id" | "at" | "step" | "purpose" | "symbol" | "model" | "keyIndex" | "status" | "tokensIn" | "tokensOut" | "tokensThink">>;

/**
 * Quien registra. Sincrónico a propósito: un pedido HTTP nunca espera a la base.
 * `record` devuelve el id de la fila para poder marcarla después (p. ej. `validacion`).
 */
export interface UsageRecorder {
  record(call: UsageCallInput): string;
  setResult(id: string, result: UsageResult): void;
}

/** Sin registro (tests, CLI sin base). */
export const NO_USAGE: UsageRecorder = { record: () => "", setResult: () => {} };
