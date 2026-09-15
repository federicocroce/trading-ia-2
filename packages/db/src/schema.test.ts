import { describe, expect, it } from "vitest";
import { CloseReason, Confidence, Direction, EventSource, EventType, Instrument, OrderSide, OrderStatus, RejectionReason, ThesisStatus, type ContributionPlan } from "@thesis/core";
import * as s from "./schema.js";

/** Paridad: los enums de Postgres deben ser exactamente los de @thesis/core. */
describe("enum parity core <-> db", () => {
  const pairs: Array<[string, readonly string[], readonly string[]]> = [
    ["event_type", EventType.options, s.eventTypeEnum.enumValues],
    ["event_source", EventSource.options, s.eventSourceEnum.enumValues],
    ["direction", Direction.options, s.directionEnum.enumValues],
    ["instrument", Instrument.options, s.instrumentEnum.enumValues],
    ["confidence", Confidence.options, s.confidenceEnum.enumValues],
    ["thesis_status", ThesisStatus.options, s.thesisStatusEnum.enumValues],
    ["rejection_reason", RejectionReason.options, s.rejectionReasonEnum.enumValues],
    ["order_side", OrderSide.options, s.orderSideEnum.enumValues],
    ["order_status", OrderStatus.options, s.orderStatusEnum.enumValues],
    ["close_reason", CloseReason.options, s.closeReasonEnum.enumValues],
  ];
  for (const [name, core, db] of pairs) {
    it(name, () => expect([...db]).toEqual([...core]));
  }
});

/**
 * Paridad plan <-> tabla. `savePlan` escribe campo por campo, así que un campo nuevo en ContributionPlan
 * que no tenga columna se pierde al guardar, en silencio. Pasó con `leftOut` y `tranches`: el plan recién
 * armado traía las exclusiones y los tramos, y al recargar la página no estaban. La regla del proyecto es
 * que cada exclusión quede explicada, y esa lista se estaba borrando sola.
 */
describe("paridad ContributionPlan <-> contribution_plans", () => {
  it("todo campo del plan tiene su columna", () => {
    const plan: Required<ContributionPlan> = { month: "2026-09", totalUsd: 0, lines: [], notes: [], leftOut: [], tranches: 1, builtAt: "2026-09-13T00:00:00.000Z", inputs: {}, changes: [], previousBuiltAt: null, controles: null, reviewsPending: [] };
    const columnas = new Set(Object.keys(s.contributionPlans));
    // `builtAt` es la cara pública de `created_at`: el plan es una foto y la pantalla tiene que poder decir
    // de cuándo es. Lo vuelca `rowToPlan`; `savePlan` lo actualiza en cada rearmado.
    const columnaDe = (k: string) => (k === "month" ? "planMonth" : k === "builtAt" ? "createdAt" : k);
    for (const k of Object.keys(plan)) {
      expect(columnas.has(columnaDe(k)), `ContributionPlan.${k} no tiene columna en contribution_plans`).toBe(true);
    }
  });
});
