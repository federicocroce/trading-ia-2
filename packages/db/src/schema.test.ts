import { describe, expect, it } from "vitest";
import { CloseReason, Confidence, Direction, EventSource, EventType, Instrument, OrderSide, OrderStatus, RejectionReason, ThesisStatus } from "@thesis/core";
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
