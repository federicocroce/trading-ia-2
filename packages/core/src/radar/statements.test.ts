import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildQuarters, type CompanyFactsJson } from "../index.js";

const zvra = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8")) as CompanyFactsJson;
const M = (n: number | null) => (n === null ? null : Math.round(n / 1e5) / 10); // millones con un decimal

describe("buildQuarters (SEC companyfacts)", () => {
  const q = buildQuarters(zvra);
  const byEnd = Object.fromEntries(q.map((x) => [x.end, x]));
  it("devuelve hasta 8 trimestres ascendentes y termina en el Q2 2026", () => {
    expect(q.length).toBeGreaterThanOrEqual(6);
    expect(q.length).toBeLessThanOrEqual(8);
    expect(q[q.length - 1]!.end).toBe("2026-06-30");
    expect(q.map((x) => x.end)).toEqual([...q.map((x) => x.end)].sort());
  });
  it("toma los trimestres directos (80–100 días)", () => {
    expect(M(byEnd["2026-06-30"]!.operatingIncome)).toBe(16.8);
    expect(M(byEnd["2026-06-30"]!.netIncome)).toBe(8.8);
    expect(M(byEnd["2026-03-31"]!.operatingIncome)).toBe(52.1);
  });
  it("deriva el Q4 como anual menos nueve meses", () => {
    const q4 = byEnd["2025-12-31"]!;
    expect(q4.fp).toBe("Q4");
    // Precisión de la fuente (USD, no millones redondeados): FY -62,943,000 - 9M -72,258,000 = 9,315,000 → 9.3M.
    expect(M(q4.operatingIncome)).toBe(9.3);
    // FY 83,229,000 - 9M 71,064,000 = 12,165,000 → 12.2M.
    expect(M(q4.netIncome)).toBe(12.2);
    // FY 3,449,000 - 9M 2,948,000 = 501,000 → 0.5M.
    expect(M(q4.taxExpense)).toBe(0.5);
  });
  it("los flujos de caja (solo acumulados) salen por diferencia", () => {
    // 6M 23,174,000 - Q1 6,142,000 = 17,032,000 → 17.0M.
    expect(M(byEnd["2026-06-30"]!.operatingCashFlow)).toBe(17.0);
    expect(M(byEnd["2026-03-31"]!.operatingCashFlow)).toBe(6.1);
  });
  it("patrimonio y acciones diluidas del trimestre; ingresos por prioridad de tags", () => {
    expect(M(byEnd["2026-06-30"]!.equity)).toBe(217.7);
    expect(Math.round(byEnd["2026-06-30"]!.dilutedShares! / 1e5) / 10).toBe(61.3);
    expect(M(byEnd["2026-06-30"]!.revenue)).toBe(39.7);
  });
  it("captura todos los ítems extraordinarios del Q1 2026, con signo", () => {
    // El fixture real trae, además de la ganancia por disposición de activos, la misma cifra
    // re-tageada bajo GainLossOnDispositionOfIntangibleAssets (double-tagging real de XBRL),
    // más una pérdida por extinción de deuda, un deterioro de intangibles y una baja de inventario:
    // todos hechos directos de 89 días (2026-01-01..2026-03-31) en us-gaap, no artefactos del dedupe.
    expect(byEnd["2026-03-31"]!.extraordinary).toEqual([
      { tag: "GainLossOnDispositionOfAssets1", value: 43_314_000 },
      { tag: "GainLossOnDispositionOfIntangibleAssets", value: 43_314_000 },
      { tag: "GainsLossesOnExtinguishmentOfDebt", value: -2_756_000 },
      { tag: "ImpairmentOfIntangibleAssetsFinitelived", value: -43_300_000 },
      { tag: "InventoryWriteDown", value: -485_000 },
    ]);
    expect(byEnd["2026-06-30"]!.extraordinary).toEqual([]);
  });
  it("sin hechos → sin trimestres", () => {
    expect(buildQuarters({ cik: 1, facts: {} })).toEqual([]);
  });
});
