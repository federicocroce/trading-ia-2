import { describe, expect, it } from "vitest";
import { comparablePeer, peerGroup, type Fundamentals } from "../index.js";

const emp = (symbol: string, metrics: Record<string, number>, peers: string[] = [], industry = "Electrical Equipment"): Fundamentals =>
  ({ symbol, asOf: "2026-09-12", metrics, peers, industry, mcapUsd: 1e9, dollarVolumeUsd: 1e8, priceUsd: 50, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });

describe("comparablePeer", () => {
  it("LWLG: sin ingresos reales, sus ratios no miden nada", () => {
    expect(comparablePeer(emp("LWLG", { psTTM: 3295.8, operatingMarginTTM: -9720.8 }))).toBe(false);
  });

  it("una empresa cara pero con ventas sigue siendo comparable", () => {
    expect(comparablePeer(emp("COHR", { psTTM: 7.8, operatingMarginTTM: 14.6 }))).toBe(true);
  });

  it("una que pierde plata pero factura también: no saca biotecnológicas normales", () => {
    expect(comparablePeer(emp("JANX", { psTTM: 12, operatingMarginTTM: -421.5 }))).toBe(true);
  });

  it("sin métricas no se descarta a nadie por las dudas", () => {
    expect(comparablePeer(emp("X", {}))).toBe(true);
  });
});

describe("peerGroup", () => {
  const universo = () => {
    const m = new Map<string, Fundamentals>();
    const sanos = ["GLW", "COHR", "LFUS", "VSH", "BDC"];
    for (const s of sanos) m.set(s, emp(s, { psTTM: 5, operatingMarginTTM: 12 }));
    m.set("LWLG", emp("LWLG", { psTTM: 3295.8, operatingMarginTTM: -9720.8 }));
    m.set("APH", emp("APH", { psTTM: 7, operatingMarginTTM: 27 }, [...sanos, "LWLG"]));
    return m;
  };

  it("el grupo de APH excluye al comparable sin ingresos", () => {
    const g = peerGroup("APH", universo())!;
    expect(g.basis).toBe("pares");
    expect(g.members).not.toContain("LWLG");
    expect(g.members).toHaveLength(5);
  });

  it("si al filtrar quedan menos del mínimo, cae a la industria", () => {
    const m = new Map<string, Fundamentals>();
    m.set("LWLG", emp("LWLG", { psTTM: 3295.8, operatingMarginTTM: -9720.8 }));
    for (const s of ["A", "B", "C", "D"]) m.set(s, emp(s, { psTTM: 5, operatingMarginTTM: 12 }));
    m.set("X", emp("X", { psTTM: 7, operatingMarginTTM: 20 }, ["LWLG"]));
    const g = peerGroup("X", m)!;
    expect(g.basis).toBe("industria");
    expect(g.members).not.toContain("LWLG");
  });
});
