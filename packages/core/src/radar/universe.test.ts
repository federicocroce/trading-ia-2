import { describe, expect, it } from "vitest";
import { isEligibleAsset, passesPreFilter, qualityBar } from "./index.js";

const q = { minMcapUsd: 500e6, minDollarVolumeUsd: 5e6, minPrice: 5 };
const pre = { minPrice: 5, minIexDollarVolume: 500_000 };

describe("universo", () => {
  it("excluye no tradables, símbolos raros, warrants/units/rights/preferred y exchanges fuera de lista", () => {
    expect(isEligibleAsset({ symbol: "AAPL", name: "Apple", exchange: "NASDAQ", tradable: true }).ok).toBe(true);
    expect(isEligibleAsset({ symbol: "BRK.A", name: "Berkshire", exchange: "NYSE", tradable: true }).reason).toMatch(/símbolo/);
    expect(isEligibleAsset({ symbol: "SCPQU", name: "Social Commerce Partners Corporation Unit", exchange: "NASDAQ", tradable: true }).reason).toMatch(/unit/i);
    expect(isEligibleAsset({ symbol: "XW", name: "X Warrant", exchange: "NYSE", tradable: true }).ok).toBe(false);
    expect(isEligibleAsset({ symbol: "ABC", name: "ABC Preferred", exchange: "NYSE", tradable: true }).ok).toBe(false);
    expect(isEligibleAsset({ symbol: "OTC1", name: "Otc", exchange: "OTC", tradable: true }).ok).toBe(false);
    expect(isEligibleAsset({ symbol: "Z", name: "Z", exchange: "NYSE", tradable: false }).ok).toBe(false);
  });
  it("pre-filtro: precio y volumen IEX en USD; sin dato no pasa", () => {
    expect(passesPreFilter({ symbol: "A", price: 10, iexVolume: 100_000 }, pre).ok).toBe(true);
    expect(passesPreFilter({ symbol: "A", price: 4, iexVolume: 1e6 }, pre).reason).toMatch(/precio/);
    expect(passesPreFilter({ symbol: "A", price: 10, iexVolume: 10_000 }, pre).reason).toMatch(/volumen/);
    expect(passesPreFilter({ symbol: "A", price: null, iexVolume: 1e6 }, pre).ok).toBe(false);
  });
  it("quality bar con capitalización y volumen en USD desde acciones en circulación y precio Alpaca", () => {
    const f = { profile: { shareOutstanding: 1000, currency: "TWD", country: "TW", industry: "Semis", name: "TSM" }, metrics: { "3MonthAverageTradingVolume": 36.5, marketCapitalization: 61_978_364 }, priceUsd: 428 };
    const r = qualityBar(f, q);
    expect(r.ok).toBe(true);
    expect(r.mcapUsd).toBe(428_000e6);
    expect(r.dollarVolumeUsd).toBeCloseTo(36.5e6 * 428, 0);
    expect(qualityBar({ ...f, profile: { ...f.profile, shareOutstanding: null } }, q).reason).toMatch(/acciones en circulación/);
    expect(qualityBar({ ...f, metrics: {} }, q).reason).toMatch(/volumen/);
    expect(qualityBar({ ...f, profile: { ...f.profile, shareOutstanding: 0.5 } }, q).reason).toMatch(/capitalización/);
    expect(qualityBar({ ...f, priceUsd: 3 }, q).reason).toMatch(/precio/);
  });
});
