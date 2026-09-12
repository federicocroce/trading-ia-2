import { describe, expect, it } from "vitest";
import { ENTRY_THRESHOLDS, entryIsNow, entryTiming, type Candle } from "../index.js";

/** Serie con rango diario controlado, para que el ATR sea predecible. */
const serie = (closes: number[], rango = 1): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse("2026-01-01") + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + rango / 2, low: c - rango / 2, close: c, volume: 1_000_000 }));

describe("entryTiming", () => {
  it("sin velas suficientes para la media de 20 no dice nada", () => {
    expect(entryTiming(serie([10, 11, 12]))).toBeNull();
    expect(entryIsNow(null)).toBe(true); // sin dato no bloquea: el plan sigue como antes
  });

  it("extendida: lejos de su media de 20 → esperar retroceso a ese nivel, con vencimiento", () => {
    // 60 ruedas planas en 100 y un salto final: el precio queda muy arriba de su media de 20.
    const e = entryTiming(serie([...Array(60).fill(100), ...Array(3).fill(112)], 2))!;
    expect(e.state).toBe("esperar_retroceso");
    expect(e.extensionAtr).toBeGreaterThanOrEqual(ENTRY_THRESHOLDS.extendedAtr);
    expect(e.level).toBe(e.sma20);
    expect(e.levelLabel).toBe("media de 20 ruedas");
    expect(e.validSessions).toBe(15);
    expect(e.why).toContain("pagar el envión");
    expect(entryIsNow(e)).toBe(false);
  });

  it("una subida lenta y sostenida NO se bloquea aunque esté en el techo de su rango: es la forma más sana", () => {
    // Sube 0,15 por rueda con rango diario de 1,5 (≈ +38% al año con volatilidad normal): siempre en el máximo
    // de 60 ruedas, pero nunca lejos de su media de 20. Es la forma de una tendencia sana y hay que poder comprarla.
    const e = entryTiming(serie(Array.from({ length: 70 }, (_, i) => 100 + i * 0.15), 1.5))!;
    expect(e.rangePct60).toBeGreaterThanOrEqual(ENTRY_THRESHOLDS.highRangePct);
    expect(e.extensionAtr).toBeLessThan(ENTRY_THRESHOLDS.extendedAtr);
    expect(e.state).toBe("en_zona");
    expect(entryIsNow(e)).toBe(true);
  });

  it("retroceso sobre tendencia: por debajo de su media de 20 pero arriba de la de 50 → es la mejor zona", () => {
    // Tendencia alcista de 60 ruedas (80 → 109,5) y un retroceso de cinco ruedas que no rompe la media de 50.
    // El retroceso tiene que ser MENOR a 3 ATR desde el máximo, o el papel ya perforó su stop y entonces
    // no es la mejor zona: es una tesis anulada. Con rango 2 el ATR es ~2, así que la caída queda en 5.
    const e = entryTiming(serie([...Array.from({ length: 60 }, (_, i) => 80 + i * 0.5), 108.5, 107.5, 106.5, 105.5, 105], 2))!;
    expect(e.sma50).not.toBeNull();
    expect(102).toBeGreaterThan(e.sma50!);
    expect(e.state).toBe("retroceso");
    expect(e.extensionAtr).toBeLessThanOrEqual(ENTRY_THRESHOLDS.pullbackAtr);
    expect(e.why).toContain("mejor zona");
    expect(entryIsNow(e)).toBe(true);
  });

  it("bajo la media de 50: no se compra a la baja, se espera el máximo de las últimas 10 ruedas", () => {
    // Cae bajo su media de 50 pero SIN perforar el stop: con rango 4 el ATR es ~4 y 3 ATR cubren la caída.
    const e = entryTiming(serie([...Array.from({ length: 60 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 20 }, (_, i) => 129 - i * 0.37)], 4))!;
    expect(e.sma50).not.toBeNull();
    expect(e.sma50!).toBeGreaterThan(122);
    expect(e.state).toBe("esperar_confirmacion");
    expect(e.levelLabel).toBe("máximo de las últimas 10 ruedas");
    expect(e.why).toContain("media de 50");
    expect(entryIsNow(e)).toBe(false);
  });

  it("en zona: ni extendida ni floja → comprar ahora, hasta 2% arriba", () => {
    const e = entryTiming(serie([...Array(60).fill(100), 100.3, 100.2, 100.4], 2))!;
    expect(e.state).toBe("en_zona");
    expect(e.level).toBeCloseTo(100.4 * 1.02, 1);
    expect(entryIsNow(e)).toBe(true);
  });

  it("la franja de compra nunca sale al revés, y cuando hay que esperar el techo queda bajo el precio de hoy", () => {
    const casos: Array<[string, Candle[]]> = [
      ["extendida", serie([...Array(60).fill(100), ...Array(3).fill(112)], 2)],
      ["retroceso", serie([...Array.from({ length: 60 }, (_, i) => 80 + i * 0.5), 108, 106, 104, 103, 102], 2)],
      ["bajo la media de 50", serie([...Array(50).fill(120), ...Array(20).fill(100)], 2)],
      ["en zona", serie([...Array(60).fill(100), 100.3, 100.2, 100.4], 2)],
    ];
    for (const [nombre, velas] of casos) {
      const e = entryTiming(velas)!;
      const close = velas[velas.length - 1]!.close;
      expect(e.low, nombre).toBeLessThanOrEqual(e.high);
      if (e.state === "esperar_retroceso") expect(e.high, nombre).toBeLessThan(close);
      if (e.state === "esperar_confirmacion") expect(e.low, nombre).toBeGreaterThan(close);
      if (entryIsNow(e)) expect(e.low, nombre).toBe(close);
    }
  });

  it("COPX del 12/9: bajo su stop no dice comprar, aunque esté barato contra su media de 20", () => {
    // La ficha decía en verde "comprar ahora, es la mejor zona" y en rojo "precio por debajo del stop",
    // sobre el mismo papel y el mismo precio. El stop manda: la tesis técnica ya se anuló.
    const cae = serie([...Array.from({ length: 60 }, (_, i) => 80 + i * 0.5), 108, 106, 104, 103, 100], 2);
    const e = entryTiming(cae)!;
    expect(e.state).toBe("esperar_confirmacion");
    expect(e.levelLabel).toBe("su stop dinámico");
    expect(e.why).toContain("ya se anuló");
    expect(entryIsNow(e)).toBe(false);
  });

  it("META del 2026-09-11: 3,4 ATR arriba de su media de 20 y 74% del rango → esperar", () => {
    // Reproduce la forma real: meseta larga y un envión final.
    const meta = serie([...Array(45).fill(590), ...Array(12).fill(600), 620, 632, 644.38], 18);
    const e = entryTiming(meta)!;
    expect(e.state).toBe("esperar_retroceso");
    expect(e.extensionAtr).toBeGreaterThan(1.5);
    expect(e.level).toBeLessThan(644.38); // el nivel a esperar está por debajo del precio de hoy
  });
});
