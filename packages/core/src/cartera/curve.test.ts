import { describe, expect, it } from "vitest";
import { buildCurve, type Candle, type Position, type Transaction } from "./index.js";

/** Fechas consecutivas desde 2025-01-01 (el calendario lo pone SPY, así que días corridos alcanzan). */
const day = (i: number) => {
  const d = new Date(Date.UTC(2025, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
const series = (closes: number[], offset = 0): Candle[] => closes.map((c, i) => ({ date: day(i + offset), open: c, high: c, low: c, close: c, volume: 1000 }));
const flat = (n: number, v = 100) => Array<number>(n).fill(v);
const tx = (o: Pick<Transaction, "symbol" | "type" | "quantity" | "price" | "date"> & Partial<Transaction>): Transaction => ({ id: `${o.symbol}-${o.type}-${o.date}`, fees: 0, currency: "USD", platform: null, externalId: null, notes: null, ...o });
const pos = (symbol: string, quantity: number): Position => ({ symbol, quantity, avgCost: 1, currency: "USD", market: "us", layer: "riesgo", notes: null });

describe("buildCurve", () => {
  it("una compra y el papel sube 10%: la curva rinde +10% con un punto por rueda", () => {
    const aaa = series([...flat(5), ...flat(5, 110)]);
    const r = buildCurve({ transactions: [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })], candles: { AAA: aaa }, spy: series(flat(10)), positions: [pos("AAA", 10)] })!;
    expect(r.from).toBe(day(0));
    expect(r.to).toBe(day(9));
    expect(r.sessions).toBe(10);
    expect(r.points).toHaveLength(10);
    expect(r.points[0]).toEqual({ date: day(0), value: 1000, index: 100, spyIndex: 100 });
    expect(r.points[9]).toEqual({ date: day(9), value: 1100, index: 110, spyIndex: 100 });
    expect(r.portfolio.totalPct).toBe(10);
    expect(r.spy.totalPct).toBe(0);
    expect(r.valueUsd).toBe(1100);
    expect(r.investedUsd).toBe(1000);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("un aporte a mitad de camino no cuenta como ganancia: TWR sigue en +10% aunque el valor sea 2200 sobre 2100", () => {
    const aaa = series([...flat(5), ...flat(5, 110)]);
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 110, date: day(6) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: aaa }, spy: series(flat(10)), positions: [pos("AAA", 20)] })!;
    expect(r.portfolio.totalPct).toBe(10);
    expect(r.valueUsd).toBe(2200);
    expect(r.investedUsd).toBe(2100);
  });

  it("el drawdown se mide sobre el índice, no sobre el valor: vender la mitad no es una caída", () => {
    const aaa = series([...flat(7), ...flat(3, 96)]);
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 100, price: 100, date: day(0) }), tx({ symbol: "AAA", type: "SELL", quantity: 50, price: 100, date: day(5) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: aaa }, spy: series(flat(10)), positions: [pos("AAA", 50)] })!;
    expect(r.portfolio.maxDrawdownPct).toBe(4);
    expect(r.portfolio.totalPct).toBe(-4);
    expect(r.valueUsd).toBe(4800);
    expect(r.investedUsd).toBe(5000);
  });

  /**
   * Un DIVIDEND es acciones, no efectivo (DRIP): así lo leen la ficha y el chequeo de pantallas desde el 13/9.
   * GGAL tiene cinco, 7,845 acciones en total, y ninguno trajo un dólar a la cuenta. Hasta el 15/9 la curva
   * los sumaba como efectivo del día y al día siguiente las acciones desaparecían de la tenencia.
   */
  it("un dividendo reinvertido son acciones que quedan: rinde ese día y sigue en la tenencia; una venta es salida", () => {
    const txs = [
      tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }),
      tx({ symbol: "AAA", type: "DIVIDEND", quantity: 0.1, price: 100, date: day(3) }),
      tx({ symbol: "AAA", type: "SELL", quantity: 5, price: 100, date: day(6) }),
    ];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 5.1)] })!;
    expect(r.portfolio.totalPct).toBe(1);
    expect(r.dividendsUsd).toBe(10);
    expect(r.points[3]!.value).toBe(1010);
    expect(r.valueUsd).toBe(510);
    expect(r.investedUsd).toBe(500);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("un traspaso que coincide con lo comprado no mueve nada; USDC cuenta como USD y otra moneda queda afuera con aviso", () => {
    const txs = [
      tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0), currency: "USDC" }),
      tx({ symbol: "AAA", type: "TRANSFER", quantity: 10, price: 49, date: day(4) }),
      tx({ symbol: "BBB", type: "BUY", quantity: 1000, price: 500, date: day(0), currency: "ARS" }),
    ];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)), BBB: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 10)] })!;
    expect(r.valueUsd).toBe(1000);
    expect(r.investedUsd).toBe(1000);
    expect(r.adjustmentsUsd).toBe(0);
    expect(r.portfolio.totalPct).toBe(0);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual(["1 operación en otra moneda queda afuera: BBB (ARS)"]);
  });

  it("un traspaso es la foto del saldo: lo que no explican las operaciones entra como aporte, no como ganancia", () => {
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "AAA", type: "TRANSFER", quantity: 12, price: 100, date: day(4) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 12)] })!;
    expect(r.valueUsd).toBe(1200);
    expect(r.portfolio.totalPct).toBe(0);
    expect(r.investedUsd).toBe(1200);
    expect(r.adjustmentsUsd).toBe(200);
    expect(r.sameMoneyInSpy?.valueUsd).toBe(1200);
    expect(r.complete).toBe(true);
    expect(r.warnings).toEqual([`AAA: el traspaso del ${day(4)} dice 12 y las operaciones registradas hasta ese día daban 10 (compras, ventas y dividendos reinvertidos); la curva toma el traspaso y la diferencia de 2 entra como aporte a 100 (USD 200), no como ganancia`]);
  });

  /**
   * Caso real del 15/9. La curva decía "tenés 157.126" contando 901,28 GGAL (solo las compras) mientras la
   * tarjeta de riesgo, en la misma pantalla y con el mismo cierre del 14/9, decía 157.964 con las 920,77 que
   * tiene la posición. La diferencia son las 7,845 acciones de dividendos reinvertidos y las 11,65 que el
   * traspaso Buenbit → Nexo del 18/4 trae sin operación que las explique.
   */
  it("GGAL 15/9: con el traspaso y los dividendos reinvertidos la curva cuenta 920,77 acciones, las mismas que Cartera", () => {
    const ggal = (type: Transaction["type"], quantity: number, price: number, date: string, currency = "USDC") => tx({ symbol: "GGAL", type, quantity, price, date, currency, id: `GGAL-${type}-${date}-${quantity}` });
    const txs = [
      ggal("BUY", 42.0487106, 47.464, "2025-07-17"),
      ggal("BUY", 95.316055, 52.3469, "2025-07-25"),
      ggal("DIVIDEND", 0.45092091, 46.15, "2025-08-21", "USD"),
      ggal("BUY", 106.81085061, 46.7181, "2025-08-21"),
      ggal("BUY", 149.82178729, 33.3029, "2025-09-08"),
      ggal("BUY", 156.22406574, 31.9317, "2025-09-23"),
      ggal("DIVIDEND", 1.13298914, 32.4628, "2025-09-23", "USD"),
      ggal("BUY", 351.05496272, 28.4229, "2025-10-07"),
      ggal("DIVIDEND", 1.45526492, 52.3616, "2025-11-17", "USD"),
      ggal("DIVIDEND", 2.50772399, 48.55, "2025-12-15", "USD"),
      ggal("DIVIDEND", 2.29808826, 55.3373, "2026-01-22", "USD"),
      ggal("TRANSFER", 920.77279309, 49, "2026-04-18", "USD"),
    ];
    // Calendario diario del 17/7/2025 al 14/9/2026; el último cierre de GGAL es el real del 14/9: 42,96.
    const fechas: string[] = [];
    for (let t = Date.parse("2025-07-17"); t <= Date.parse("2026-09-14"); t += 86_400_000) fechas.push(new Date(t).toISOString().slice(0, 10));
    const vela = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1000 });
    const r = buildCurve({
      transactions: txs,
      candles: { GGAL: fechas.map((d, k) => vela(d, k === fechas.length - 1 ? 42.96 : 45)) },
      spy: fechas.map((d) => vela(d, 700)),
      positions: [{ symbol: "GGAL", quantity: 920.77279309, avgCost: 34.6788, currency: "USD", market: "adr", layer: "riesgo", notes: null }],
    })!;
    expect(r.to).toBe("2026-09-14");
    // 920,77279309 × 42,96: lo mismo que la tarjeta de riesgo le da a GGAL con ese cierre.
    expect(r.valueUsd).toBe(39556.4);
    expect(r.warnings.some((w) => w.includes("las operaciones suman"))).toBe(false);
    expect(r.warnings).toContain("GGAL: el traspaso del 2026-04-18 dice 920.7728 y las operaciones registradas hasta ese día daban 909.1214 (compras, ventas y dividendos reinvertidos); la curva toma el traspaso y la diferencia de 11.6514 entra como aporte a 49 (USD 570.92), no como ganancia");
    expect(r.adjustmentsUsd).toBe(570.92);
    expect(r.complete).toBe(true);
  });

  it("un papel sin velas queda afuera con aviso y la curva se marca incompleta", () => {
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "CCC", type: "BUY", quantity: 5, price: 50, date: day(0) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 10), pos("CCC", 5)] })!;
    expect(r.complete).toBe(false);
    expect(r.warnings).toEqual(["CCC: sin velas guardadas, queda afuera de la curva"]);
    expect(r.investedUsd).toBe(1000);
    expect(r.valueUsd).toBe(1000);
  });

  it("un papel cuyas velas empiezan después de su primera operación queda afuera con aviso", () => {
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "CCC", type: "BUY", quantity: 5, price: 50, date: day(0) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)), CCC: series(flat(5), 5) }, spy: series(flat(10)), positions: [pos("AAA", 10), pos("CCC", 5)] })!;
    expect(r.complete).toBe(false);
    expect(r.warnings).toEqual([`CCC: sin velas hasta su primera operación (${day(0)}), queda afuera de la curva`]);
    expect(r.investedUsd).toBe(1000);
  });

  it("avisa cuando las operaciones no cuadran con las posiciones cargadas", () => {
    const r = buildCurve({ transactions: [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })], candles: { AAA: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 12), pos("DDD", 3)] })!;
    expect(r.complete).toBe(false);
    expect(r.warnings).toEqual([
      "AAA: las operaciones suman 10 y la posición cargada dice 12; la curva usa las operaciones",
      "DDD: posición cargada sin operaciones, no entra en la curva",
    ]);
  });

  it("una operación posterior a la última vela no entra todavía y se avisa, sin marcar descuadre", () => {
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "AAA", type: "BUY", quantity: 5, price: 100, date: day(20) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 15)] })!;
    expect(r.investedUsd).toBe(1000);
    expect(r.warnings).toEqual([`1 operación posterior a la última vela (${day(9)}) no entra todavía: AAA ${day(20)}`]);
  });

  it("SPY: rendimiento de comprar y quedarse, y cuánto valdría la misma plata puesta en SPY en las mismas fechas", () => {
    const spy = series([...flat(5), ...flat(4, 110), 120]);
    const aaa = series([...flat(5), ...flat(5, 110)]);
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 110, date: day(6) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: aaa }, spy, positions: [pos("AAA", 20)] })!;
    expect(r.spy.totalPct).toBe(20);
    expect(r.spy.maxDrawdownPct).toBe(0);
    expect(r.sameMoneyInSpy).toEqual({ valueUsd: 2400, xirrPct: null });
  });

  it("con menos de 60 ruedas no anualiza ni calcula XIRR; con menos de 20 tampoco da volatilidad", () => {
    const r = buildCurve({ transactions: [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })], candles: { AAA: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 10)] })!;
    expect(r.portfolio.annualPct).toBeNull();
    expect(r.portfolio.xirrPct).toBeNull();
    expect(r.portfolio.volPct).toBeNull();
    expect(r.spy.annualPct).toBeNull();
    expect(r.spy.volPct).toBeNull();
    expect(r.sameMoneyInSpy?.xirrPct).toBeNull();
  });

  it("con una sola compra y un año de ruedas, el anualizado y el XIRR coinciden con el total", () => {
    const n = 366; // day(0)..day(365): 365 días calendario
    const closes = Array.from({ length: n }, (_, i) => 100 + (10 * i) / (n - 1));
    const r = buildCurve({ transactions: [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })], candles: { AAA: series(closes) }, spy: series(flat(n)), positions: [pos("AAA", 10)] })!;
    expect(r.portfolio.totalPct).toBe(10);
    expect(r.portfolio.annualPct).toBeCloseTo(10, 1);
    expect(r.portfolio.xirrPct).toBeCloseTo(10, 1);
    expect(r.spy.annualPct).toBe(0);
    expect(r.sameMoneyInSpy?.valueUsd).toBe(1000);
    expect(r.sameMoneyInSpy?.xirrPct).toBeCloseTo(0, 1);
  });

  it("volatilidad anualizada: 0 en una serie plana, ~16.07% alternando 100/101 cada día", () => {
    const buy = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })];
    const flatR = buildCurve({ transactions: buy, candles: { AAA: series(flat(30)) }, spy: series(flat(30)), positions: [pos("AAA", 10)] })!;
    expect(flatR.portfolio.volPct).toBe(0);
    const zig = Array.from({ length: 30 }, (_, i) => (i % 2 ? 101 : 100));
    const r = buildCurve({ transactions: buy, candles: { AAA: series(zig) }, spy: series(zig), positions: [pos("AAA", 10)] })!;
    expect(r.portfolio.volPct).toBeCloseTo(16.07, 1);
    expect(r.spy.volPct).toBeCloseTo(16.07, 1);
  });

  it("la lectura en una línea dice si le ganás a SPY, con qué volatilidad y qué caída", () => {
    const short = buildCurve({ transactions: [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })], candles: { AAA: series([...flat(5), ...flat(5, 110)]) }, spy: series(flat(10)), positions: [pos("AAA", 10)] })!;
    expect(short.reading).toBe(`Desde ${day(0)} (10 ruedas, sin anualizar): tu cartera +10.0%, SPY +0.0%. Le ganás por 10.0 puntos. Caída máxima 0.0% contra 0.0% de SPY.`);
    const n = 366;
    const closes = Array.from({ length: n }, (_, i) => 100 + (10 * i) / (n - 1));
    const long = buildCurve({ transactions: [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })], candles: { AAA: series(closes) }, spy: series(flat(n)), positions: [pos("AAA", 10)] })!;
    expect(long.reading).toBe(`Desde ${day(0)} (12 meses): tu cartera +10.0% anual, SPY +0.0%. Le ganás por 10.0 puntos. Volatilidad 0.0% contra 0.0% de SPY; caída máxima 0.0% contra 0.0%.`);
  });

  it("sin velas de SPY no hay calendario: falla en vez de inventar", () => {
    const buy = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) })];
    expect(() => buildCurve({ transactions: buy, candles: { AAA: series(flat(10)) }, spy: [], positions: [] })).toThrow(/SPY/);
    expect(() => buildCurve({ transactions: buy, candles: { AAA: series(flat(10)) }, spy: series(flat(3), -5), positions: [] })).toThrow(/SPY/);
  });

  it("operaciones que dejan tenencia sin posición cargada: aviso y curva incompleta", () => {
    const txs = [tx({ symbol: "AAA", type: "BUY", quantity: 10, price: 100, date: day(0) }), tx({ symbol: "EEE", type: "BUY", quantity: 5, price: 10, date: day(0) }), tx({ symbol: "EEE", type: "SELL", quantity: 5, price: 10, date: day(2) }), tx({ symbol: "FFF", type: "BUY", quantity: 3, price: 10, date: day(0) })];
    const r = buildCurve({ transactions: txs, candles: { AAA: series(flat(10)), EEE: series(flat(10)), FFF: series(flat(10)) }, spy: series(flat(10)), positions: [pos("AAA", 10)] })!;
    expect(r.complete).toBe(false);
    expect(r.warnings).toEqual(["FFF: las operaciones dejan 3 pero no hay posición cargada; la curva usa las operaciones"]);
  });
});
