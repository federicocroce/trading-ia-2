import { describe, expect, it } from "vitest";
import { eventUniverse } from "../src/index.js";

const cand = (symbol: string, verdict: "COMPRAR" | "OBSERVAR" | "NUCLEO", kind: "stock" | "etf" | "ar" | "cedear" | "watch") => ({ symbol, verdict, kind });
const base = { config: { us: ["NEM"], adr: ["YPF"] }, positions: [], watchlist: [], plan: null, candidates: [] };

describe("eventUniverse", () => {
  it("suma los COMPRAR del Radar de tipo acción y seguimiento", () => {
    const u = eventUniverse({ ...base, candidates: [cand("VRT", "COMPRAR", "stock"), cand("MP", "COMPRAR", "watch")] });
    expect(u).toEqual(["NEM", "YPF", "VRT", "MP"]);
  });
  it("deja afuera OBSERVAR, NUCLEO, ETFs, argentinas y CEDEARs", () => {
    const u = eventUniverse({
      ...base,
      candidates: [cand("CEG", "OBSERVAR", "stock"), cand("SPY", "NUCLEO", "etf"), cand("XLE", "COMPRAR", "etf"), cand("ALUA.BA", "COMPRAR", "ar"), cand("AAPL", "COMPRAR", "cedear")],
    });
    expect(u).toEqual(["NEM", "YPF"]);
  });
  it("une config, posiciones, seguimiento y plan, en mayúsculas, sin repetidos y sin .BA", () => {
    const u = eventUniverse({
      config: { us: ["nem"], adr: ["YPF"] },
      positions: [{ symbol: "NEM" }, { symbol: "GGAL.BA" }],
      watchlist: [{ symbol: "vst" }],
      plan: { lines: [{ symbol: "YPF" }, { symbol: "CCJ" }] },
      candidates: [cand("VST", "COMPRAR", "stock")],
    });
    expect(u).toEqual(["NEM", "YPF", "VST", "CCJ"]);
  });
});
