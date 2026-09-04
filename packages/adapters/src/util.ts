import { randomUUID } from "node:crypto";
import type { RawEvent } from "@thesis/core";

export function newEvent(e: Omit<RawEvent, "id" | "observedAt" | "payload"> & { payload?: Record<string, unknown> }): RawEvent {
  return { id: randomUUID(), observedAt: new Date().toISOString(), payload: e.payload ?? {}, ...e };
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
