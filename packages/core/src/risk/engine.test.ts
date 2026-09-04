import { describe, expect, it } from "vitest";
import { DefaultRiskEngine } from "./engine.js";
import type { PortfolioSnapshot } from "../contracts/index.js";
import type { Thesis } from "../schemas/thesis.js";

const base: Thesis = {
  id: "11111111-1111-4111-8111-111111111111",
  rawEventId: "22222222-2222-4222-8222-222222222222",
  ticker: "XXXX",
  eventType: "earnings",
  eventDate: "2026-10-14",
  direction: "long",
  pEstimate: 0.72,
  pMarket: 0.55,
  edge: 0.17,
  instrument: "stock",
  entryMax: 12.4,
  target: 18,
  invalidation: "Guidance Q4 por debajo de consenso en el call de earnings.",
  confidence: "med",
  reasoning: "Resumen de razonamiento con al menos cincuenta caracteres para pasar la validación mínima.",
  sources: ["edgar:x"],
  status: "approved",
  rejectionReason: null,
  promptVersion: "v0",
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
};

const portfolio: PortfolioSnapshot = {
  capitalUsd: 100_000,
  openByThesis: {},
  openByEventType: {},
  dailyPnlUsd: 0,
  killSwitch: false,
};

const engine = new DefaultRiskEngine();

describe("DefaultRiskEngine", () => {
  it("dimensiona al 10% del capital para acciones", () => {
    const d = engine.size(base, 10, portfolio);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.intent.qty).toBe(1000);
      expect(d.intent.notionalUsd).toBe(10_000);
    }
  });
  it("dimensiona al 3% en prima para opciones (x100)", () => {
    const d = engine.size({ ...base, instrument: "call" }, 2.5, portfolio);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.intent.qty).toBe(12); // 3000 / 250
      expect(d.intent.notionalUsd).toBe(3000);
    }
  });
  it("respeta el tope por tipo de evento", () => {
    const d = engine.size(base, 10, { ...portfolio, openByEventType: { earnings: 25_000 } });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.intent.notionalUsd).toBe(5000);
  });
  it("rechaza si el tipo está en el límite", () => {
    const d = engine.size(base, 10, { ...portfolio, openByEventType: { earnings: 30_000 } });
    expect(d).toMatchObject({ ok: false, rule: "max_per_event_type" });
  });
  it("kill switch bloquea todo", () => {
    expect(engine.size(base, 10, { ...portfolio, killSwitch: true })).toMatchObject({ ok: false, rule: "kill_switch" });
  });
  it("pérdida diaria del 3% pausa", () => {
    expect(engine.size(base, 10, { ...portfolio, dailyPnlUsd: -3000 })).toMatchObject({ ok: false, rule: "max_daily_loss" });
  });
  it("solo ejecuta tesis aprobadas por humano", () => {
    expect(engine.size({ ...base, status: "proposed" }, 10, portfolio)).toMatchObject({ ok: false, rule: "not_approved" });
  });
  it("rechaza edge bajo el umbral", () => {
    expect(engine.size({ ...base, edge: 0.05 }, 10, portfolio)).toMatchObject({ ok: false, rule: "min_edge" });
  });
  it("rechaza precio por encima de entryMax", () => {
    expect(engine.size(base, 13, portfolio)).toMatchObject({ ok: false, rule: "entry_price" });
  });
  it("no duplica exposición en la misma tesis", () => {
    expect(engine.size(base, 10, { ...portfolio, openByThesis: { [base.id]: 5000 } })).toMatchObject({ ok: false, rule: "already_open" });
  });
  it("cero apalancamiento: no hay short de acciones en v1", () => {
    expect(engine.size({ ...base, direction: "short" }, 10, portfolio)).toMatchObject({ ok: false, rule: "no_short_stock" });
  });
});
