import { z } from "zod";
import { Instrument } from "./thesis.js";

export const OrderSide = z.enum(["buy", "sell"]);
export type OrderSide = z.infer<typeof OrderSide>;

export const OrderStatus = z.enum(["pending", "submitted", "filled", "partially_filled", "cancelled", "rejected"]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Intención de orden que sale del módulo de riesgo. Siempre atada a una tesis. */
export const OrderIntent = z.object({
  thesisId: z.string().uuid(),
  ticker: z.string().min(1).max(12),
  instrument: Instrument,
  /** Símbolo OCC para opciones; igual a ticker para acciones. */
  symbol: z.string().min(1),
  side: OrderSide,
  qty: z.number().int().positive(),
  limitPrice: z.number().positive(),
  /** Exposición nocional en USD que esta orden agrega. */
  notionalUsd: z.number().positive(),
});
export type OrderIntent = z.infer<typeof OrderIntent>;

export const Order = OrderIntent.extend({
  id: z.string().uuid(),
  brokerOrderId: z.string().nullable(),
  status: OrderStatus,
  filledQty: z.number().int().nonnegative(),
  avgFillPrice: z.number().nonnegative().nullable(),
  submittedAt: z.string().datetime().nullable(),
  filledAt: z.string().datetime().nullable(),
});
export type Order = z.infer<typeof Order>;
