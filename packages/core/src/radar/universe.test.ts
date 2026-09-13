import { describe, expect, it } from "vitest";
import { isEligibleAsset, mcapUsd, passesPreFilter, qualityBar } from "./index.js";

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
  it("excluye fondos y fideicomisos por nombre (ETF, ETN, Fund, Grayscale, Bitcoin/Ethereum Trust…)", () => {
    for (const name of ["Grayscale Ethereum Trust", "iShares Bitcoin Trust", "SPDR Gold Shares", "Vanguard Total Market ETF", "ProShares UltraPro QQQ", "Some Income Fund"]) {
      expect(isEligibleAsset({ symbol: "XXX", name, exchange: "NYSE", tradable: true }).ok).toBe(false);
    }
    expect(isEligibleAsset({ symbol: "KRG", name: "Kite Realty Group Trust", exchange: "NYSE", tradable: true }).ok).toBe(true); // REIT legítimo
  });
  it("pre-filtro: precio y volumen IEX en USD; sin dato no pasa", () => {
    expect(passesPreFilter({ symbol: "A", price: 10, iexVolume: 100_000 }, pre).ok).toBe(true);
    expect(passesPreFilter({ symbol: "A", price: 4, iexVolume: 1e6 }, pre).reason).toMatch(/precio/);
    expect(passesPreFilter({ symbol: "A", price: 10, iexVolume: 10_000 }, pre).reason).toMatch(/volumen/);
    expect(passesPreFilter({ symbol: "A", price: null, iexVolume: 1e6 }, pre).ok).toBe(false);
  });
  it("quality bar con capitalización y volumen en USD desde acciones en circulación y precio Alpaca", () => {
    const f = { profile: { shareOutstanding: 1000, currency: "USD", country: "US", industry: "Semis", name: "AAA" }, metrics: { "3MonthAverageTradingVolume": 36.5 }, priceUsd: 428 };
    const r = qualityBar(f, q);
    expect(r.ok).toBe(true);
    expect(r.mcapUsd).toBe(428_000e6);
    expect(r.dollarVolumeUsd).toBeCloseTo(36.5e6 * 428, 0);
    expect(qualityBar({ ...f, profile: { ...f.profile, shareOutstanding: null } }, q).reason).toMatch(/acciones en circulación/);
    expect(qualityBar({ ...f, metrics: {} }, q).reason).toMatch(/volumen/);
    expect(qualityBar({ ...f, profile: { ...f.profile, shareOutstanding: 0.5 } }, q).reason).toMatch(/capitalización/);
    expect(qualityBar({ ...f, priceUsd: 3 }, q).reason).toMatch(/precio/);
  });

  it("TSM: el precio del ADR por las acciones locales daba 11,1 billones; ahora manda la publicada o queda desconocida", () => {
    // Un ADR de TSM son 5 ordinarias. 428,64 × 25.932 M daba 11,1 billones contra ~2,2 reales.
    const tsm = { profile: { shareOutstanding: 25_932, currency: "TWD", country: "TW", industry: "Semis", name: "TSM", marketCap: 61_978_362_246_094 }, metrics: { "3MonthAverageTradingVolume": 36.5 }, priceUsd: 428.64 };
    expect(mcapUsd(tsm.profile.shareOutstanding, tsm.priceUsd, tsm.profile)).toBeNull();
    // Como extranjero, el universo ya permite capitalización desconocida: no se lo saca por esto.
    expect(qualityBar(tsm, q, { allowUnknownMcap: true }).ok).toBe(true);
    expect(qualityBar(tsm, q).reason).toMatch(/TWD/);
  });

  it("APH: con la capitalización publicada en dólares manda esa, no el producto con acciones pre-split", () => {
    // 1.230,2 M de acciones (pre-split) × 82,80 daba 101,9 mil millones; la publicada es 204,1.
    const aph = { marketCap: 204_132_750_897, currency: "USD" };
    expect(mcapUsd(1230.23, 82.8, aph)).toBe(204_132_750_897);
  });

  it("NVDA: la publicada y el cálculo coinciden, así que el control tiene dientes", () => {
    const nvda = { marketCap: 5_551_700_000_000, currency: "USD" };
    const calculada = 24_200 * 1e6 * 229.83;
    expect(Math.abs(mcapUsd(24_200, 229.83, nvda)! - calculada) / calculada).toBeLessThan(0.01);
  });
  it("ADR: volumen de Yahoo cuando Finnhub no lo tiene y capitalización desconocida permitida", () => {
    const adr = { profile: { shareOutstanding: 1325, currency: "ARS", country: "AR", industry: "Banking", name: "GGAL" }, metrics: {}, priceUsd: 44.36 };
    expect(qualityBar(adr, q).ok).toBe(false);
    const r = qualityBar(adr, q, { volumeOverrideUsd: 36.8e6, allowUnknownMcap: true });
    expect(r.ok).toBe(true);
    expect(r.mcapUsd).toBeNull();
    expect(r.dollarVolumeUsd).toBe(36.8e6);
    expect(qualityBar(adr, q, { volumeOverrideUsd: 1e6, allowUnknownMcap: true }).reason).toMatch(/volumen/);
  });
});
