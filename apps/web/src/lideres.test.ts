import { describe, expect, it } from "vitest";
import type { Candidate } from "./api";
import { filasDeLideres } from "./lideres";

const fila = (over: Partial<Candidate>): Candidate => ({ candidateDate: "2026-09-21", symbol: "X", kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 10, close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 10_000, sizeQty: 98, riskScore: 4, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, spyClose: null, alpha7dPct: null, alpha30dPct: null, alpha90dPct: null, tags: null, ...over });

describe("filasDeLideres (21/9)", () => {
  it("SIMO en retroceso: franja, stop, objetivo y MEDIO tamaño; META esperando: el nivel a esperar y sin boleto", () => {
    const rows = [
      fila({ symbol: "META", kind: "watch", verdict: "OBSERVAR", close: 665.75, flags: ["no_perseguir", "lider_esperando"], entry: { state: "esperar_retroceso", level: 660.2, levelLabel: "media de 20 ruedas", low: 653.6, high: 660.2, validSessions: 15, sma20: 660.2, sma50: 640, atr14: 14, extensionAtr: 2.1, rangePct60: 95, why: "x" } }),
      fila({ symbol: "SIMO", close: 253.3, entryLow: 253.3, entryHigh: 258.37, stop: 232.1, target: 310.9, sizeUsd: 9_001, flags: ["consenso_compra", "sorpresa_positiva", "subio_mucho_12m", "lider_en_retroceso"] }),
      fila({ symbol: "APH", flags: ["sorpresa_positiva"] }),
    ];
    expect(filasDeLideres(rows)).toEqual([
      { symbol: "SIMO", estado: "en_retroceso", close: 253.3, franja: "253,30 a 258,37", stop: 232.1, target: 310.9, medioTamanoUsd: 4500, aFavor: ["consenso de compra", "sorprendió para arriba"], porQue: "subió más de 100% en 12 meses" },
      { symbol: "META", estado: "esperando", close: 665.75, franja: "esperar 660,20 (media de 20 ruedas)", stop: null, target: null, medioTamanoUsd: null, aFavor: [], porQue: "subió más de 15% en 21 ruedas" },
    ]);
  });
  it("BE el 21/9: en zona por la media pero subió más de 15% en 21 ruedas: lo que espera es eso, y lo dice", () => {
    const be = fila({ symbol: "BE", verdict: "OBSERVAR", flags: ["no_perseguir", "subio_mucho_12m", "lider_esperando"], entry: { state: "en_zona", level: 270.94, levelLabel: "hasta 2% sobre el precio", low: 265.63, high: 270.94, validSessions: 15, sma20: 250, sma50: 230, atr14: 12, extensionAtr: 1, rangePct60: 90, why: "x" } });
    expect(filasDeLideres([be])[0]!.franja).toBe("esperar: subió más de 15% en 21 ruedas, todavía es perseguirla");
  });
  it("un símbolo que está en el Radar y en seguimiento aparece una sola vez", () => {
    const x = fila({ symbol: "SNDK", flags: ["subio_mucho_12m", "lider_esperando"] });
    expect(filasDeLideres([x, { ...x, kind: "watch" }])).toHaveLength(1);
  });
});
