import type { UsageSource } from "./types.js";

/** Límite conocido de una fuente. null = sin límite que nos afecte. */
export interface SourceLimit {
  perMinute: number | null;
  perDay: number | null;
  /** La cuota es por modelo y por clave (proyecto), no por fuente entera. */
  perModelKey?: boolean;
}

/**
 * Límites conservadores del plan gratis, en código para que el panel los muestre contra el uso.
 * Gemini: por proyecto y por modelo; cada clave es un proyecto distinto (confirmado 2026-09-10).
 * Google publica 10 RPM y entre 250 y 1.500 RPD según el modelo: se toma el piso.
 */
export const USAGE_LIMITS: Record<UsageSource, SourceLimit> = {
  gemini: { perMinute: 10, perDay: 250, perModelKey: true },
  finnhub: { perMinute: 60, perDay: null },
  alpaca: { perMinute: 200, perDay: null },
  sec: { perMinute: 600, perDay: null },
  yahoo: { perMinute: null, perDay: null },
  otro: { perMinute: null, perDay: null },
};

/** USD por millón de tokens (la salida incluye el pensamiento). Página de precios de Gemini, septiembre 2026. */
export const GEMINI_PRICING: Array<{ prefix: string; inPerM: number; outPerM: number }> = [
  { prefix: "gemini-2.5-flash-lite", inPerM: 0.1, outPerM: 0.4 },
  { prefix: "gemini-2.5-flash", inPerM: 0.3, outPerM: 2.5 },
  { prefix: "gemini-3", inPerM: 0.75, outPerM: 3.75 },
];

export function priceFor(model: string | null): { inPerM: number; outPerM: number } | null {
  if (!model) return null;
  return GEMINI_PRICING.find((p) => model.startsWith(p.prefix)) ?? null;
}

/** Costo equivalente si se pagara: tokens de entrada al precio de entrada, salida + pensamiento al de salida. */
export function estimateCostUsd(model: string | null, tokensIn: number | null, tokensOut: number | null, tokensThink: number | null): number {
  const p = priceFor(model);
  if (!p) return 0;
  return ((tokensIn ?? 0) * p.inPerM + ((tokensOut ?? 0) + (tokensThink ?? 0)) * p.outPerM) / 1e6;
}

export const GEMINI_HOST = "generativelanguage.googleapis.com";

/** Fuente por host. Lo que no se conoce es "otro" (dolarapi, boletín oficial, diarios…). */
export function sourceForHost(host: string): UsageSource {
  const h = host.toLowerCase();
  if (h === GEMINI_HOST) return "gemini";
  if (h.endsWith("finnhub.io")) return "finnhub";
  if (h.endsWith("alpaca.markets")) return "alpaca";
  if (h.endsWith("sec.gov")) return "sec";
  if (h.endsWith("yahoo.com")) return "yahoo";
  return "otro";
}
