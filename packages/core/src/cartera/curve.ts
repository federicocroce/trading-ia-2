import type { Candle, Position, Transaction } from "./types.js";

/**
 * Curva de la cartera real reconstruida desde las operaciones (puro, sin I/O).
 *
 * El calendario lo ponen las ruedas de SPY. Las tenencias salen de compras y ventas; los traspasos
 * se ignoran. Un aporte no es ganancia: el retorno diario se calcula contra el valor de ayer más lo
 * que entró hoy (retorno ponderado por tiempo). El índice base 100 encadena esos retornos.
 *
 * Fail-closed: un papel sin velas queda afuera y se dice; una operación que no cuadra con la posición
 * cargada se dice; nada se inventa.
 */
export interface CurveInput {
  transactions: Transaction[];
  /** Velas por símbolo, ascendentes por fecha. */
  candles: Record<string, Candle[]>;
  spy: Candle[];
  /** Posiciones cargadas, para avisar si las operaciones no cuadran con ellas. */
  positions: Position[];
}
export interface CurvePoint {
  date: string;
  /** Valor de mercado de las tenencias a cierre, USD. */
  value: number;
  /** Índice base 100 de la cartera (TWR encadenado). */
  index: number;
  /** Índice base 100 de comprar SPY el primer día y no tocarlo. */
  spyIndex: number;
}
export interface CurveMetrics {
  totalPct: number;
  /** Retorno ponderado por tiempo anualizado. null con menos de 60 ruedas: anualizar dos meses es inventar. */
  annualPct: number | null;
  /** Retorno ponderado por plata (XIRR con los flujos reales). Para SPY: la misma plata en las mismas fechas. */
  xirrPct: number | null;
  /** Desvío de los retornos diarios × √252, en %. null con menos de 20 ruedas. */
  volPct: number | null;
  /** Peor caída desde un máximo del índice, en %. Sobre el índice y no sobre el valor: un retiro no es una caída. */
  maxDrawdownPct: number;
}
export interface CurveReport {
  from: string;
  to: string;
  sessions: number;
  points: CurvePoint[];
  portfolio: CurveMetrics;
  spy: CurveMetrics;
  valueUsd: number;
  /** Aportes netos: compras (con comisiones) menos ventas. */
  investedUsd: number;
  dividendsUsd: number;
  /** Cada compra tuya simulada en SPY el mismo día con los mismos dólares (sin dividendos de SPY). */
  sameMoneyInSpy: { valueUsd: number; xirrPct: number | null } | null;
  /** Una línea en palabras, por regla. */
  reading: string;
  /** false si algo que debería estar en la curva quedó afuera o no cuadra (ver `warnings`). */
  complete: boolean;
  warnings: string[];
}

const USD_LIKE = new Set(["USD", "USDC"]);
const RECONCILE_TOLERANCE = 0.005;
const MIN_SESSIONS_ANNUAL = 60;
const MIN_SESSIONS_VOL = 20;
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const qty = (n: number) => Number(n.toFixed(4)).toString();
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** Desvío muestral de retornos diarios anualizado, en %. null con pocas observaciones. */
export function annualizedVolPct(returns: number[]): number | null {
  if (returns.length < MIN_SESSIONS_VOL - 1) return null;
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const v = returns.reduce((a, r) => a + (r - m) ** 2, 0) / (returns.length - 1);
  return round2(Math.sqrt(v) * Math.sqrt(252) * 100);
}

/** TIR de flujos fechados (XIRR), en % anual. Bisección; null si no hay entradas y salidas o no converge. */
export function xirrPct(flows: Array<{ date: string; amount: number }>): number | null {
  if (!flows.some((f) => f.amount < 0) || !flows.some((f) => f.amount > 0)) return null;
  const t0 = Date.parse(flows[0]!.date);
  const years = flows.map((f) => (Date.parse(f.date) - t0) / (365 * DAY_MS));
  const npv = (r: number) => flows.reduce((sum, f, k) => sum + f.amount / (1 + r) ** years[k]!, 0);
  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  if (!Number.isFinite(flo) || flo * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (fm === 0) return round2(mid * 100);
    if (fm * flo > 0) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return round2(((lo + hi) / 2) * 100);
}

/** Peor caída en % de una serie de índice que arranca en 100. */
export function maxDrawdownPct(index: number[]): number {
  let peak = 100;
  let dd = 0;
  for (const v of index) {
    peak = Math.max(peak, v);
    dd = Math.max(dd, (100 * (peak - v)) / peak);
  }
  return round2(dd);
}

export function buildCurve(i: CurveInput): CurveReport | null {
  if (!i.spy.length) throw new Error("sin velas de SPY: no hay calendario para la curva");
  const warnings: string[] = [];
  let complete = true;
  const byDate = (a: Transaction, b: Transaction) => a.date.localeCompare(b.date);

  // 1. Moneda: la curva es en dólares (USDC cuenta). Lo demás queda afuera, con aviso.
  const usd = i.transactions.filter((t) => USD_LIKE.has(t.currency.toUpperCase()));
  const other = i.transactions.filter((t) => !USD_LIKE.has(t.currency.toUpperCase()));
  if (other.length) {
    const who = [...new Set(other.map((t) => `${t.symbol} (${t.currency})`))].join(", ");
    warnings.push(`${other.length} ${plural(other.length, "operación en otra moneda queda", "operaciones en otra moneda quedan")} afuera: ${who}`);
  }
  const allFlows = usd.filter((t) => t.type === "BUY" || t.type === "SELL").sort(byDate);
  const allDivs = usd.filter((t) => t.type === "DIVIDEND").sort(byDate);
  if (!allFlows.length) return null;

  // 2. Calendario: ruedas de SPY desde la primera operación.
  const from = allFlows[0]!.date;
  const calendar = i.spy.filter((c) => c.date >= from);
  if (!calendar.length) throw new Error(`sin velas de SPY desde la primera operación (${from})`);
  const to = calendar[calendar.length - 1]!.date;
  const sessionOnOrAfter = (date: string) => calendar.find((c) => c.date >= date)?.date ?? null;

  // 3. Papeles sin velas hasta su primera operación quedan afuera (flujos y dividendos incluidos).
  const excluded = new Set<string>();
  for (const s of [...new Set(allFlows.map((t) => t.symbol))]) {
    const c = i.candles[s] ?? [];
    const first = allFlows.find((t) => t.symbol === s)!.date;
    const session = sessionOnOrAfter(first);
    if (session === null) continue; // todavía no hay rueda para medirla: se trata abajo como pendiente
    if (!c.length) warnings.push(`${s}: sin velas guardadas, queda afuera de la curva`);
    else if (c[0]!.date > session) warnings.push(`${s}: sin velas hasta su primera operación (${first}), queda afuera de la curva`);
    else continue;
    excluded.add(s);
    complete = false;
  }
  const flows = allFlows.filter((t) => !excluded.has(t.symbol));
  const divs = allDivs.filter((t) => !excluded.has(t.symbol));

  // 4. Operaciones posteriores a la última vela: no entran todavía, pero sí cuentan para el cuadre.
  const pending = flows.filter((t) => t.date > to);
  if (pending.length) {
    warnings.push(`${pending.length} ${plural(pending.length, "operación posterior", "operaciones posteriores")} a la última vela (${to}) no ${plural(pending.length, "entra", "entran")} todavía: ${pending.map((t) => `${t.symbol} ${t.date}`).join(", ")}`);
  }

  // Cierre vigente por símbolo: el último conocido hasta la fecha (puntero que avanza con el calendario).
  const symbols = [...new Set(flows.map((t) => t.symbol))];
  const cursor: Record<string, number> = {};
  const lastClose: Record<string, number | null> = {};
  for (const s of symbols) {
    cursor[s] = 0;
    lastClose[s] = null;
  }
  const advance = (s: string, date: string) => {
    const c = i.candles[s] ?? [];
    while (cursor[s]! < c.length && c[cursor[s]!]!.date <= date) {
      lastClose[s] = c[cursor[s]!]!.close;
      cursor[s]!++;
    }
  };

  const holdings: Record<string, number> = Object.fromEntries(symbols.map((s) => [s, 0]));
  const points: CurvePoint[] = [];
  let prevValue = 0;
  let index = 100;
  let invested = 0;
  let dividends = 0;
  let f = 0;
  let d = 0;
  const spy0 = calendar[0]!.close;
  const returns: number[] = [];
  const spyReturns: number[] = [];
  const cash: Array<{ date: string; amount: number }> = [];
  const spyCash: Array<{ date: string; amount: number }> = [];
  let spyShares = 0;
  let prevSpy: number | null = null;
  for (const day of calendar) {
    // Flujos del día: una compra entra a su costo (con comisiones); una venta sale a lo que dejó.
    let flow = 0;
    while (f < flows.length && flows[f]!.date <= day.date) {
      const t = flows[f]!;
      const sign = t.type === "BUY" ? 1 : -1;
      const usd = sign * t.quantity * t.price + t.fees;
      holdings[t.symbol] = (holdings[t.symbol] ?? 0) + sign * t.quantity;
      flow += usd;
      cash.push({ date: day.date, amount: -usd });
      spyCash.push({ date: day.date, amount: -usd });
      spyShares += usd / day.close;
      f++;
    }
    invested += flow;
    // Dividendos cobrados hoy: retorno del día, aunque el efectivo no quede en lo que medimos.
    let div = 0;
    while (d < divs.length && divs[d]!.date <= day.date) {
      div += divs[d]!.quantity * divs[d]!.price;
      d++;
    }
    dividends += div;
    if (div > 0) cash.push({ date: day.date, amount: div });
    let value = 0;
    for (const s of symbols) {
      advance(s, day.date);
      value += holdings[s]! * (lastClose[s] ?? 0);
    }
    const base = prevValue + flow;
    const r = base > 0 ? (value + div) / base - 1 : 0;
    index *= 1 + r;
    // Para la volatilidad cuentan las ruedas con capital al arrancar el día (misma vara que SPY, que arranca en el primer cierre).
    if (prevValue > 0) returns.push(r);
    if (prevSpy !== null) spyReturns.push(day.close / prevSpy - 1);
    prevSpy = day.close;
    points.push({ date: day.date, value: round2(value), index: round2(index), spyIndex: round2((100 * day.close) / spy0) });
    prevValue = value;
  }

  // 5. Cuadre contra las posiciones cargadas (con las operaciones pendientes incluidas).
  const reconstructed: Record<string, number> = { ...holdings };
  for (const t of pending) reconstructed[t.symbol] = (reconstructed[t.symbol] ?? 0) + (t.type === "BUY" ? 1 : -1) * t.quantity;
  for (const p of i.positions) {
    if (!USD_LIKE.has(p.currency.toUpperCase()) || excluded.has(p.symbol)) continue;
    const h = reconstructed[p.symbol];
    if (h === undefined) {
      warnings.push(`${p.symbol}: posición cargada sin operaciones, no entra en la curva`);
      complete = false;
    } else if (Math.abs(h - p.quantity) > RECONCILE_TOLERANCE * Math.max(p.quantity, 1e-9)) {
      warnings.push(`${p.symbol}: las operaciones suman ${qty(h)} y la posición cargada dice ${qty(p.quantity)}; la curva usa las operaciones`);
      complete = false;
    }
  }
  const loaded = new Set(i.positions.map((p) => p.symbol));
  for (const [s, h] of Object.entries(reconstructed)) {
    if (loaded.has(s) || h <= RECONCILE_TOLERANCE) continue;
    warnings.push(`${s}: las operaciones dejan ${qty(h)} pero no hay posición cargada; la curva usa las operaciones`);
    complete = false;
  }

  // 6. Métricas. Anualizar y XIRR solo con historia suficiente; SPY con la misma vara.
  const last = points[points.length - 1]!;
  const sessions = points.length;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
  const enough = sessions >= MIN_SESSIONS_ANNUAL && days > 0;
  const annual = (totalPct: number) => (enough ? round2(((1 + totalPct / 100) ** (365 / days) - 1) * 100) : null);
  const total = round2(index - 100);
  const spyTotal = round2(last.spyIndex - 100);
  const spyValue = round2(spyShares * calendar[calendar.length - 1]!.close);
  const portfolio: CurveMetrics = {
    totalPct: total,
    annualPct: annual(total),
    xirrPct: enough ? xirrPct([...cash, { date: to, amount: last.value }]) : null,
    volPct: sessions >= MIN_SESSIONS_VOL ? annualizedVolPct(returns) : null,
    maxDrawdownPct: maxDrawdownPct(points.map((p) => p.index)),
  };
  const spy: CurveMetrics = {
    totalPct: spyTotal,
    annualPct: annual(spyTotal),
    xirrPct: enough ? xirrPct([...spyCash, { date: to, amount: spyValue }]) : null,
    volPct: sessions >= MIN_SESSIONS_VOL ? annualizedVolPct(spyReturns) : null,
    maxDrawdownPct: maxDrawdownPct(points.map((p) => p.spyIndex)),
  };
  return {
    from,
    to,
    sessions,
    points,
    portfolio,
    spy,
    valueUsd: last.value,
    investedUsd: round2(invested),
    dividendsUsd: round2(dividends),
    sameMoneyInSpy: { valueUsd: spyValue, xirrPct: spy.xirrPct },
    reading: readingFor(from, sessions, days, portfolio, spy),
    complete,
    warnings,
  };
}

/** Una línea por regla: quién ganó, por cuánto, con qué volatilidad y qué caída. Sin modelo. */
export function readingFor(from: string, sessions: number, days: number, p: CurveMetrics, s: CurveMetrics): string {
  const mine = p.annualPct ?? p.totalPct;
  const theirs = p.annualPct !== null && s.annualPct !== null ? s.annualPct : s.totalPct;
  const diff = round2(mine - theirs);
  const verdict = diff > 0 ? `Le ganás por ${diff.toFixed(1)} puntos.` : diff < 0 ? `No le ganás: ${Math.abs(diff).toFixed(1)} puntos abajo.` : "Empate con SPY.";
  if (p.annualPct === null) {
    return `Desde ${from} (${sessions} ruedas, sin anualizar): tu cartera ${signed(p.totalPct)}, SPY ${signed(s.totalPct)}. ${verdict} Caída máxima ${p.maxDrawdownPct.toFixed(1)}% contra ${s.maxDrawdownPct.toFixed(1)}% de SPY.`;
  }
  const months = Math.round(days / 30.44);
  const vol = p.volPct !== null && s.volPct !== null ? ` Volatilidad ${p.volPct.toFixed(1)}% contra ${s.volPct.toFixed(1)}% de SPY;` : "";
  return `Desde ${from} (${months} meses): tu cartera ${signed(p.annualPct)} anual, SPY ${signed(theirs)}. ${verdict}${vol} caída máxima ${p.maxDrawdownPct.toFixed(1)}% contra ${s.maxDrawdownPct.toFixed(1)}%.`;
}
