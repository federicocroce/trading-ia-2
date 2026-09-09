import { describe, expect, it } from "vitest";
import type { CardInput } from "@thesis/core";
import { CARD_SYSTEM, CARD_TOOL, CARD_VERSION, GeminiCardWriter, buildCardMessage, parseCard } from "../src/index.js";

const input: CardInput = {
  symbol: "NVDA", name: "NVIDIA", industry: "Semiconductors", sector: "Tecnología", themes: ["semiconductores"], themeOptions: ["IA", "semiconductores", "defensa"],
  verdict: "COMPRAR", score: 1.84, axes: { valuation: -0.4, quality: 2.1, growth: 2.5, balance: 1.2 }, rankInGroup: 1, groupSize: 8, basis: "pares",
  own: { peTTM: 45.2, roeTTM: 91.3, revenueGrowthTTMYoy: 114 }, medians: { peTTM: 28.1, roeTTM: 22.4, revenueGrowthTTMYoy: 18 }, peers: ["AMD", "AVGO", "QCOM"],
  flags: ["insiders_venden", "consenso_compra"], insiders: { buys: 0, sells: 4 }, analyst: { strongBuy: 20, buy: 30, hold: 5, sell: 0, strongSell: 0, period: "2026-09" },
  surprises: [{ period: "2026-06-30", surprisePercent: 6.2 }], filings: ["8-K — resultados Q2", "10-Q"], close: 180.5, stop: 165.2, target: 211.1, riskScore: 5,
};

function fakeFetch(args: unknown) {
  const calls: any[] = [];
  const f = (async (_u: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "candidate_card", args } }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const good = { summary: "Diseña GPUs.", whyRanks: "Rankea 1/8 con ROE 91.3 vs mediana 22.4.", mainRisk: "P/E 45.2 sobre la mediana 28.1.", moat: "fuerte", themes: ["IA", "semiconductores", "inventado"], degrade: false };

describe("ficha de candidato", () => {
  it("el mensaje lleva verdict, ejes, medianas, pares, banderas, temas permitidos y filings", () => {
    const m = buildCardMessage(input);
    for (const s of ["COMPRAR", "1/8", "pares", "91.3", "22.4", "AMD", "insiders_venden", "IA, semiconductores, defensa", "8-K", "165.2", "riesgo 5"]) expect(m).toContain(s);
  });
  it("parseCard: descarta temas fuera de la lista, exige motivo al degradar, rechaza extras y moat inválido", () => {
    expect(parseCard(good, input.themeOptions).themes).toEqual(["IA", "semiconductores"]);
    expect(() => parseCard({ ...good, degrade: true }, input.themeOptions)).toThrow();
    expect(parseCard({ ...good, degrade: true, degradeReason: "8-K: guidance recortado" }, input.themeOptions).degrade).toBe(true);
    expect(() => parseCard({ ...good, verdict: "VENDER" }, input.themeOptions)).toThrow();
    expect(() => parseCard({ ...good, moat: "enorme" }, input.themeOptions)).toThrow();
    expect(parseCard({ ...good, degradeReason: "" }, input.themeOptions).degradeReason).toBeUndefined(); // el modelo manda "" cuando no degrada
  });
  it("GeminiCardWriter manda system, mensaje y tool candidate_card forzada", async () => {
    const { f, calls } = fakeFetch(good);
    const card = await new GeminiCardWriter({ keys: ["k"], fetch: f }).write(input);
    expect(card.moat).toBe("fuerte");
    expect(calls[0].systemInstruction.parts[0].text).toBe(CARD_SYSTEM);
    expect(calls[0].tools[0].functionDeclarations[0].name).toBe(CARD_TOOL.name);
    expect(calls[0].toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(["candidate_card"]);
  });
  it("versión estable con hash", () => expect(CARD_VERSION).toMatch(/^c1-[0-9a-f]{12}$/));
  it("con estados: el mensaje lleva los trimestres, el TTM núcleo y el ítem extraordinario; sin estados lo dice", () => {
    const q = { start: "2026-04-01", end: "2026-06-30", fp: "Q2", revenue: 39.7e6, operatingIncome: 16.8e6, netIncome: 8.8e6, pretaxIncome: 12.8e6, taxExpense: 4e6, nonoperatingIncome: null, operatingCashFlow: 17.1e6, capex: 0, dilutedShares: 61.3e6, equity: 217.7e6, extraordinary: [] };
    const core = { asOf: "2026-06-30", revenueTTM: 136.1e6, operatingIncomeTTM: 82.4e6, coreOperatingIncomeTTM: 39.1e6, netIncomeTTM: 58.3e6, coreNetIncomeTTM: 32.9e6, coreEpsTTM: 0.54, operatingCashFlowTTM: 32.6e6, freeCashFlowTTM: 32.6e6, equity: 217.7e6, taxRate: 0.16, extraordinaryTTM: 43.3e6, extraordinaryItems: [{ tag: "GainLossOnDispositionOfAssets1", quarterEnd: "2026-03-31", value: 43.3e6 }], deviationPct: 0.43 };
    const m = buildCardMessage({ ...input, quarters: [q], core });
    for (const s of ["Estados (SEC", "2026-06-30: ingresos 39.7M", "neto núcleo 32.9M", "desvío 43%", "GainLossOnDispositionOfAssets1 43.3M (2026-03-31)"]) expect(m).toContain(s);
    expect(buildCardMessage({ ...input, quarters: [], core: null })).toContain("sin estados");
    expect(buildCardMessage(input)).not.toContain("Estados (SEC");
    expect(CARD_SYSTEM).toContain("ganancia núcleo");
  });
});
