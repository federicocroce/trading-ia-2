import { describe, expect, it } from "vitest";
import { assetClassFor, mergeThemes, sectorFor, themesFor, type TaxonomyConfig } from "./index.js";

const t: TaxonomyConfig = {
  sectors: ["Tecnología", "Energía", "Otros"],
  themes: ["IA", "semiconductores", "petroleo_gas", "argentina", "bitcoin"],
  industryToSector: { Semiconductors: "Tecnología", Energy: "Energía" },
  industryToThemes: { Semiconductors: ["semiconductores"], Energy: ["petroleo_gas"] },
  symbolToThemes: { TSM: ["IA", "china_taiwan"], YPF: ["argentina"] },
  symbolToAssetClass: { BTC: "cripto" },
};

describe("taxonomía", () => {
  it("clase: etf > override > adr por país > accion_us", () => {
    expect(assetClassFor({ symbol: "VTI", country: "US", isEtf: true }, t)).toBe("etf");
    expect(assetClassFor({ symbol: "BTC", country: null, isEtf: false }, t)).toBe("cripto");
    expect(assetClassFor({ symbol: "TSM", country: "TW", isEtf: false }, t)).toBe("adr");
    expect(assetClassFor({ symbol: "VIST", country: "MX", isEtf: false, positionMarket: "adr" }, t)).toBe("adr");
    expect(assetClassFor({ symbol: "NEM", country: "US", isEtf: false }, t)).toBe("accion_us");
  });
  it("sector por tabla; Otros si no mapea", () => {
    expect(sectorFor("Semiconductors", t)).toBe("Tecnología");
    expect(sectorFor("Rarísima", t)).toBe("Otros");
    expect(sectorFor(null, t)).toBe("Otros");
  });
  it("temas por industria y símbolo, sin duplicados y solo de la lista", () => {
    expect(themesFor({ symbol: "TSM", industry: "Semiconductors" }, t)).toEqual(["semiconductores", "IA"]); // china_taiwan no está en t.themes
    expect(themesFor({ symbol: "YPF", industry: "Energy" }, t)).toEqual(["petroleo_gas", "argentina"]);
    expect(themesFor({ symbol: "ZZZ", industry: null }, t)).toEqual([]);
  });
  it("mergeThemes: manual nunca se pisa; modelo suma a regla; fuera de lista se descarta", () => {
    expect(mergeThemes(null, ["IA", "inventado"], "modelo", t)).toEqual({ themes: ["IA"], source: "modelo" });
    expect(mergeThemes({ themes: ["bitcoin"], source: "manual" }, ["IA"], "modelo", t)).toEqual({ themes: ["bitcoin"], source: "manual" });
    expect(mergeThemes({ themes: ["bitcoin"], source: "regla" }, ["IA"], "modelo", t)).toEqual({ themes: ["bitcoin", "IA"], source: "modelo" });
    expect(mergeThemes({ themes: ["bitcoin"], source: "modelo" }, ["IA"], "regla", t)).toEqual({ themes: ["bitcoin", "IA"], source: "modelo" });
  });
});
