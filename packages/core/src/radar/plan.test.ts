import { describe, expect, it } from "vitest";
import { planContribution, type EtfConfig, type PlanInput } from "../index.js";

const c = { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50, coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
const core: EtfConfig[] = [
  { symbol: "VTI", name: "VTI", role: "nucleo", exposure: "rv_us", ter: 0.03, themes: [], coreWeight: 0.6 },
  { symbol: "VEA", name: "VEA", role: "nucleo", exposure: "rv_internacional", ter: 0.05, themes: [], coreWeight: 0.25 },
  { symbol: "VWO", name: "VWO", role: "nucleo", exposure: "emergentes", ter: 0.08, themes: [], coreWeight: 0.15 },
];
const base: PlanInput = {
  month: "2026-09", portfolioValueUsd: 100_000,
  positions: [{ symbol: "TSM", valueUsd: 7_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 65_000, assetClass: "adr" }, { symbol: "GGAL", valueUsd: 28_000, assetClass: "adr" }],
  sumarCandidates: [], buyCandidates: [], coreEtfs: core, spyClose: 500, closes: { VTI: 300, VEA: 55, VWO: 48, TSM: 428, NVDA: 180, AMD: 160 },
};

describe("planContribution", () => {
  it("una línea que hay que esperar no cuenta como plata ejecutable hoy, y la nota lo dice", () => {
    const esperando = { state: "esperar_retroceso" as const, level: 150, levelLabel: "media de 20 ruedas", low: 148.5, high: 150, validSessions: 15, sma20: 150, sma50: 140, atr14: 4, extensionAtr: 2.5, rangePct60: 90, why: "está 2.5 ATR arriba de su media de 20" };
    const p = planContribution({
      ...base,
      buyCandidates: [
        { symbol: "AMD", kind: "stock", priority: 2.1, score: 2.1, sizeUsd: 9_000, close: 160, stop: 150, entry: esperando },
        { symbol: "NVDA", kind: "stock", priority: 1.5, score: 1.5, sizeUsd: 9_000, close: 180, stop: 170 },
      ],
    }, c);
    const amd = p.lines.find((l) => l.symbol === "AMD")!;
    const nota = p.notes.find((n) => n.startsWith("Hoy se ejecutan"))!;
    expect(nota).toContain(`USD ${Math.round(p.totalUsd) - Math.round(amd.amountUsd)} de USD ${Math.round(p.totalUsd)}`);
    expect(nota).toContain("AMD en 150");
    expect(nota).toContain("orden limitada, no a mercado");
  });

  it("si todas las líneas se pueden comprar hoy no aparece la nota de espera", () => {
    const p = planContribution({ ...base, buyCandidates: [{ symbol: "NVDA", kind: "stock", priority: 1.5, score: 1.5, sizeUsd: 9_000, close: 180, stop: 170 }] }, c);
    expect(p.notes.some((n) => n.startsWith("Hoy se ejecutan"))).toBe(false);
  });

  it("núcleo vacío → todo el aporte al núcleo, repartido por peso objetivo", () => {
    const p = planContribution(base, c);
    expect(p.totalUsd).toBe(6500);
    expect(p.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["VTI", "nucleo", 3900], ["VEA", "nucleo", 1625], ["VWO", "nucleo", 975]]);
    expect(p.lines[0]!.close).toBe(300);
    expect(p.lines[0]!.spyClose).toBe(500);
  });
  it("núcleo lleno → SUMAR primero (tope 50% del aporte), luego COMPRAR por score; máximo de nuevas; sobrante al núcleo", () => {
    const i: PlanInput = {
      ...base,
      positions: [{ symbol: "VTI", valueUsd: 45_000, assetClass: "etf", role: "nucleo" }, { symbol: "TSM", valueUsd: 7_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 20_000, assetClass: "adr" }, { symbol: "GGAL", valueUsd: 28_000, assetClass: "adr" }],
      sumarCandidates: [{ symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 400 }],
      buyCandidates: [{ symbol: "AMD", kind: "stock", priority: 1.5, score: 1.5, sizeUsd: 9_000, close: 160, stop: 150 }, { symbol: "NVDA", kind: "stock", priority: 2.1, score: 2.1, sizeUsd: 14_994, close: 180, stop: 170 }, { symbol: "XLE", kind: "etf", priority: 1.1, score: null, sizeUsd: 5_000, close: 90 }],
    };
    // SUMAR toma hasta el 30% del resto; las nuevas se ordenan por prioridad (convicción) y respetan el máximo de nuevas (acciones + ETFs).
    const p = planContribution(i, { ...c, maxNewPositionsPerMonth: 1 });
    expect(p.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["TSM", "sumar", 1950], ["NVDA", "comprar", 3250], ["VTI", "nucleo", 780], ["VEA", "nucleo", 325], ["VWO", "nucleo", 195]]);
    const p2 = planContribution({ ...i, sumarCandidates: [] }, { ...c, maxNewPositionsPerMonth: 1 });
    expect(p2.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["NVDA", "comprar", 3250], ["VTI", "nucleo", 1950], ["VEA", "nucleo", 813], ["VWO", "nucleo", 487]]);
    expect(p2.notes.join(" ")).toMatch(/AMD \(2° por convicción: tope de 1 posiciones nuevas\)/);
  });
  it("un monto grande con el núcleo vacío: 60% al núcleo, SUMAR hasta 30% del resto, nuevas por convicción repartidas parejo, una de seguimiento, ticket completo", () => {
    const i: PlanInput = {
      ...base,
      portfolioValueUsd: 158_000,
      positions: [{ symbol: "GGAL", valueUsd: 40_000, assetClass: "adr" }, { symbol: "PAM", valueUsd: 31_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 29_000, assetClass: "adr" }, { symbol: "VIST", valueUsd: 17_000, assetClass: "adr" }, { symbol: "HUT", valueUsd: 14_400, assetClass: "accion_us" }, { symbol: "TSM", valueUsd: 11_600, assetClass: "accion_us" }, { symbol: "MARA", valueUsd: 7_500, assetClass: "accion_us" }, { symbol: "NEM", valueUsd: 5_800, assetClass: "accion_us" }],
      sumarCandidates: [{ symbol: "TSM", valueUsd: 11_600, weightPct: 7.4, stop: 400 }, { symbol: "NEM", valueUsd: 5_800, weightPct: 3.7, stop: 118.5, target: 152.4 }],
      buyCandidates: [
        { symbol: "NVDA", kind: "stock", priority: 1.49, score: 1.29, sizeUsd: 15_661, close: 225.79, entryHigh: 230.31, stop: 214.15, target: 249.07 },
        { symbol: "NBN", kind: "stock", priority: 1.54, score: 1.14, sizeUsd: 15_729, close: 131.8, entryHigh: 134.44, stop: 128.13, target: 139.14 },
        { symbol: "ZVRA", kind: "stock", priority: 1.73, score: 1.33, sizeUsd: 15_336, close: 12.67, entryHigh: 12.92, stop: 11.59, target: 14.83 },
        { symbol: "COPX", kind: "etf", priority: 1.96, score: null, sizeUsd: null, close: 94.84, stop: 88 },
        { symbol: "CEG", kind: "watch", priority: -2, score: 0.06, sizeUsd: 15_685, close: 301.52, entryHigh: 307.55, stop: 277.84, target: 348.88 },
        { symbol: "CRWV", kind: "watch", priority: -7, score: 0.36, sizeUsd: 15_729, close: 103.5, stop: 95 },
      ],
      closes: { ...base.closes, ZVRA: 12.67, NBN: 131.8, NVDA: 225.79, CEG: 301.52, COPX: 94.84, NEM: 90, CRWV: 103.5 },
    };
    const p = planContribution(i, c, { amountUsd: 40_000 });
    expect(p.totalUsd).toBe(40_000);
    // Un monto de 6 aportes admite dos posiciones nuevas extra (una por cada 3 aportes): entran las tres acciones y el ETF satélite,
    // repartidas por convicción (pieza 5), no parejo.
    expect(p.lines.map((l) => [l.symbol, l.kind])).toEqual([
      ["VTI", "nucleo"], ["VEA", "nucleo"], ["VWO", "nucleo"],
      ["NEM", "sumar"],
      ["ZVRA", "comprar"], ["NBN", "comprar"], ["NVDA", "comprar"], ["CEG", "seguimiento"], ["COPX", "comprar"],
    ]);
    expect(p.lines.slice(0, 4).map((l) => l.amountUsd)).toEqual([14_400, 6_000, 3_600, 4_800]);
    const zvraUsd = p.lines.find((l) => l.symbol === "ZVRA")!.amountUsd;
    const nvdaUsd = p.lines.find((l) => l.symbol === "NVDA")!.amountUsd;
    expect(zvraUsd).toBeGreaterThan(nvdaUsd); // más convicción, más plata
    expect(p.lines.slice(4).reduce((s, l) => s + l.amountUsd, 0)).toBe(11_200);
    // Con el aporte mensual normal, el tope sigue siendo el de la política.
    const mensual = planContribution({ ...i, closes: i.closes }, c);
    expect(mensual.lines.filter((l) => l.kind === "comprar").map((l) => l.symbol)).toEqual(["ZVRA", "NBN"]);
    // Explicabilidad: cada COMPRAR que no entró aparece en las notas con su lugar por convicción y el motivo.
    expect(mensual.notes.join("\n")).toMatch(/NVDA \(3° por convicción: tope de 2 posiciones nuevas\)/);
    expect(mensual.leftOut!.find((x) => x.symbol === "CRWV")?.reason).toMatch(/seguimiento/);
    expect(mensual.leftOut!.some((x) => x.symbol === "COPX")).toBe(true);
    for (const b of i.buyCandidates) expect(mensual.lines.some((l) => l.symbol === b.symbol) || mensual.leftOut!.some((x) => x.symbol === b.symbol)).toBe(true);
    expect(p.lines.reduce((s, l) => s + l.amountUsd, 0)).toBe(40_000);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.rationale).toMatch(/^3° por convicción de 3 COMPRAR del Radar/);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.priority).toBe(1.49);
    expect(p.lines.find((l) => l.symbol === "ZVRA")!.rationale).toMatch(/^1° por convicción de 3/);
    const nem = p.lines.find((l) => l.symbol === "NEM")!;
    expect([nem.stop, nem.target]).toEqual([118.5, 152.4]); // el stop y objetivo del veredicto de Cartera viajan a la línea SUMAR
    const zvra = p.lines.find((l) => l.symbol === "ZVRA")!;
    expect([zvra.entryHigh, zvra.stop, zvra.target]).toEqual([12.92, 11.59, 14.83]);
    expect(p.lines.some((l) => l.symbol === "COPX" && l.kind === "comprar")).toBe(true); // con 4 nuevas el ETF satélite entra
  });
  it("una salvedad del candidato (se mueve como algo tuyo) queda escrita en la razón de la línea", () => {
    const i: PlanInput = {
      ...base,
      positions: [{ symbol: "VTI", valueUsd: 45_000, assetClass: "etf", role: "nucleo" }, { symbol: "TSM", valueUsd: 7_000, assetClass: "adr" }, { symbol: "YPF", valueUsd: 20_000, assetClass: "adr" }, { symbol: "GGAL", valueUsd: 28_000, assetClass: "adr" }],
      buyCandidates: [{ symbol: "NVDA", kind: "stock", priority: 1.8, score: 2.1, sizeUsd: 14_994, close: 180, stop: 170, cautions: ["se mueve como TSM que ya tenés (correlación 0.81)"] }],
    };
    const p = planContribution(i, { ...c, maxNewPositionsPerMonth: 1 });
    expect(p.lines.find((l) => l.symbol === "NVDA")!.rationale).toMatch(/^1° por convicción de 1 COMPRAR del Radar, convicción 1\.8, score 2\.1 · ⚠ se mueve como TSM que ya tenés \(correlación 0\.81\)$/);
  });
  describe("quién entra al plan (13/9)", () => {
    // El dueño preguntó: "si antes estaba NBN, ¿qué me asegura que GFI esté correcto como siguiente?". Nada, si GFI
    // pasó por la misma verificación que dejó pasar a NBN. La siguiente entra solo verificada con el cuestionario
    // vigente; un lugar que ninguna llena va al núcleo, no a un ETF ni repartido entre las demás.
    type Buy = PlanInput["buyCandidates"][number];
    const apta = { verdict: "apto" as const, reason: "ok", current: true };
    const stock = (symbol: string, priority: number, verification: Exclude<Buy["verification"], undefined>): Buy => ({ symbol, kind: "stock", priority, score: priority, sizeUsd: 20_000, close: 100, entryHigh: 102, stop: 90, target: 126, verification });
    const cuarenta = (buys: Buy[], extra: Partial<PlanInput> = {}) => planContribution({ ...base, closes: { ...base.closes, APH: 84, NBN: 132, LNC: 44, GFI: 45, XLF: 57 }, buyCandidates: [...buys, { symbol: "XLF", kind: "etf", priority: 1.1, score: null, sizeUsd: 5_000, close: 57, entryHigh: 58, stop: 55, target: 64 }], ...extra }, c, { amountUsd: 40_000 });
    const nucleo = (p: ReturnType<typeof planContribution>) => p.lines.filter((l) => l.kind === "nucleo").reduce((s, l) => s + l.amountUsd, 0);

    it("verificada con el cuestionario anterior no entra, y la siguiente vigente la reemplaza", () => {
      const p = cuarenta([stock("NBN", 1.63, { ...apta, current: false }), stock("APH", 1.58, apta), stock("NVDA", 1.44, apta), stock("LNC", 1.33, apta), stock("GFI", 0.9, apta)]);
      expect(p.leftOut!.find((x) => x.symbol === "NBN")!.reason).toMatch(/cuestionario anterior/);
      expect(p.lines.map((l) => l.symbol)).toEqual(expect.arrayContaining(["APH", "NVDA", "LNC", "GFI"]));
      expect(p.lines.some((l) => l.symbol === "XLF")).toBe(false);
    });
    it("si ninguna la reemplaza, el lugar no lo toma un ETF ni se reparte: va al núcleo y la nota lo dice", () => {
      const lleno = cuarenta([stock("NBN", 1.63, apta), stock("APH", 1.58, apta), stock("NVDA", 1.44, apta), stock("LNC", 1.33, apta)]);
      const vacio = cuarenta([stock("NBN", 1.63, { verdict: "con_reservas", reason: "sorpresa por impuestos", current: true }), stock("APH", 1.58, apta), stock("NVDA", 1.44, apta), stock("LNC", 1.33, apta), stock("GFI", 0.9, { ...apta, current: false })]);
      expect(vacio.lines.some((l) => l.symbol === "XLF")).toBe(false);
      expect(vacio.lines.some((l) => l.symbol === "GFI")).toBe(false);
      // Las que entraron reciben lo mismo que con el lugar lleno: la parte de NBN no se reparte entre ellas.
      for (const s of ["APH", "NVDA", "LNC"]) expect(vacio.lines.find((l) => l.symbol === s)!.amountUsd).toBeCloseTo(lleno.lines.find((l) => l.symbol === s)!.amountUsd, -1);
      expect(nucleo(vacio)).toBeGreaterThan(nucleo(lleno));
      expect(vacio.notes.join(" ")).toMatch(/lugar.*núcleo/i);
      expect(vacio.lines.reduce((s, l) => s + l.amountUsd, 0)).toBe(40_000);
    });
    it("NBN del 14/9: un banco sin estados legibles no entra aunque la verificación web diga apta", () => {
      const p = cuarenta([{ ...stock("NBN", 1.63, apta), flags: ["sin_estados", "banco_sin_estados"] }, stock("APH", 1.58, apta)]);
      expect(p.leftOut!.find((x) => x.symbol === "NBN")!.reason).toMatch(/banco sin estados/);
      expect(p.lines.some((l) => l.symbol === "NBN")).toBe(false);
    });
    it("una acción con la verificación pendiente tampoco entra", () => {
      const p = cuarenta([stock("NBN", 1.63, null), stock("APH", 1.58, apta)]);
      expect(p.leftOut!.find((x) => x.symbol === "NBN")!.reason).toMatch(/pendiente/);
    });
    it("un SUMAR cuya verificación no está apta no se suma: su parte va al núcleo", () => {
      const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 413.63, target: 498.44 };
      const sano = cuarenta([], { sumarCandidates: [{ ...tsm, verification: apta }] });
      const conReservas = cuarenta([], { sumarCandidates: [{ ...tsm, verification: { verdict: "con_reservas", reason: "prima del ADR", current: true } }] });
      expect(sano.lines.some((l) => l.symbol === "TSM" && l.kind === "sumar")).toBe(true);
      expect(conReservas.lines.some((l) => l.symbol === "TSM")).toBe(false);
      expect(conReservas.notes.join(" ")).toMatch(/No se sumó TSM/);
      expect(nucleo(conReservas)).toBeGreaterThan(nucleo(sano));
    });
  });

  it("reunión de la Fed dentro de 3 días hábiles: el plan dice desde cuándo va el primer tramo (13/9)", () => {
    const fomc = (today: string) => planContribution({ ...base, fomc: { today, decisions: ["2026-09-16", "2026-10-28"] } }, c, { amountUsd: 40_000 });
    expect(fomc("2026-09-13").notes.join(" ")).toMatch(/La Fed decide el 16\/9: el primer tramo va desde el 17\/9/);
    expect(fomc("2026-09-01").notes.join(" ")).not.toMatch(/La Fed/);
  });

  it("sin candidatos y núcleo lleno → todo al núcleo con nota", () => {
    const p = planContribution({ ...base, positions: [{ symbol: "VTI", valueUsd: 50_000, assetClass: "etf", role: "nucleo" }, { symbol: "YPF", valueUsd: 50_000, assetClass: "adr" }] }, c);
    expect(p.lines.every((l) => l.kind === "nucleo")).toBe(true);
    expect(p.lines.reduce((s, l) => s + l.amountUsd, 0)).toBe(6500);
    expect(p.notes.join(" ")).toMatch(/sin candidatos/i);
  });
  it("sin núcleo definido → sobrante queda en nota", () => {
    const p = planContribution({ ...base, coreEtfs: [] }, c);
    expect(p.lines).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/6500/);
  });
});

describe("antes de comprar: el stop fuera del ruido y una posición que diversifique (14/9)", () => {
  type Buy = PlanInput["buyCandidates"][number];
  const apta = { verdict: "apto" as const, reason: "ok", current: true };
  const compra = (symbol: string, priority: number, close: number, stop: number, atr: number | null, extra: Partial<Buy> = {}): Buy => ({ symbol, kind: "stock", priority, score: priority, sizeUsd: 20_000, close, entryHigh: close * 1.02, stop, target: close * 1.2, verification: apta, atr, ...extra });
  const cuarenta = (i: Partial<PlanInput>) => planContribution({ ...base, closes: { ...base.closes, TSM: 418.01, APH: 78.55, NVDA: 211, GFI: 43.09 }, ...i }, c, { amountUsd: 40_000 });
  const nucleo = (p: ReturnType<typeof planContribution>) => p.lines.filter((l) => l.kind === "nucleo").reduce((s, l) => s + l.amountUsd, 0);

  it("TSM el 14/9: cerró en 418 con el stop de la posición en 413,63 (0,4 ATR): no se suma y su parte va al núcleo", () => {
    const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 413.63, target: 498.44, verification: apta, atr: 11 };
    const con = cuarenta({ sumarCandidates: [tsm] });
    const sin = cuarenta({ sumarCandidates: [{ ...tsm, stop: 380 }] });
    expect(con.lines.some((l) => l.symbol === "TSM")).toBe(false);
    expect(con.notes.join(" ")).toMatch(/No se sumó TSM: .*0,4 ATR del stop/);
    expect(sin.lines.find((l) => l.symbol === "TSM")!.kind).toBe("sumar");
    expect(nucleo(con)).toBeGreaterThan(nucleo(sin));
  });
  it("APH el 14/9: cerró en 78,55 con el stop de la orden en 77,81 (0,3 ATR): no se compra, lo dice y el lugar va al núcleo", () => {
    const p = cuarenta({ buyCandidates: [compra("APH", 1.6, 78.55, 77.81, 2.44), compra("NVDA", 1.1, 211, 199.06, 8)] });
    expect(p.lines.some((l) => l.symbol === "APH")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "APH")!.reason).toMatch(/0,3 ATR del stop.*ruido/);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.kind).toBe("comprar");
  });
  it("una compra nueva que se mueve como algo que ya tenés (GFI con NEM, 0,86) no entra: no diversifica", () => {
    const gfi = compra("GFI", 0.7, 43.09, 38, 1.6, { overlap: { with: "NEM", corr: 0.86 } });
    const p = cuarenta({ buyCandidates: [compra("NVDA", 1.1, 211, 199.06, 8), gfi] });
    expect(p.lines.some((l) => l.symbol === "GFI")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "GFI")!.reason).toMatch(/se mueve como NEM que ya tenés \(correlación 0,86\): no diversifica/);
    // Debajo del umbral entra, con la salvedad que ya tenía.
    const q = cuarenta({ buyCandidates: [compra("NVDA", 1.1, 211, 199.06, 8), { ...gfi, overlap: { with: "NEM", corr: 0.75 } }] });
    expect(q.lines.some((l) => l.symbol === "GFI")).toBe(true);
  });
  it("cada orden dice debajo de qué precio ya no se ejecuta: stop + 1 ATR", () => {
    const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 380, target: 498.44, verification: apta, atr: 11 };
    const p = cuarenta({ sumarCandidates: [tsm], buyCandidates: [compra("NVDA", 1.1, 211, 199.06, 8)] });
    expect(p.lines.find((l) => l.symbol === "NVDA")!.minPrice).toBe(207.06);
    expect(p.lines.find((l) => l.symbol === "TSM")!.minPrice).toBe(391);
    // Sin ATR no se inventa un piso.
    const sinAtr = cuarenta({ buyCandidates: [compra("NVDA", 1.1, 211, 199.06, null)] });
    expect(sinAtr.lines.find((l) => l.symbol === "NVDA")!.minPrice).toBeNull();
  });
});

describe("revisión antes de comprar (15/9)", () => {
  /*
   * Una segunda búsqueda, independiente de la verificación, sobre lo que el plan va a comprar: razones para NO
   * comprarla hoy. El 14/9 la verificación dio "apto" a GFI sin ver que la licencia de Tarkwa vence en abril de 2027.
   * Solo "sin objeciones" deja comprar; lo que no se revisó todavía queda pendiente y el plan lo dice.
   */
  type Buy = PlanInput["buyCandidates"][number];
  const apta = { verdict: "apto" as const, reason: "ok", current: true };
  const sin = { verdict: "sin_objeciones" as const, reason: "sin objeciones" };
  const compra = (symbol: string, priority: number, review: Buy["review"]): Buy => ({ symbol, kind: "stock", priority, score: priority, sizeUsd: 20_000, close: 100, entryHigh: 102, stop: 90, target: 126, verification: apta, atr: 2, review });
  const cuarenta = (buys: Buy[], sumar: PlanInput["sumarCandidates"] = []) => planContribution({ ...base, closes: { ...base.closes, APH: 100, GFI: 100, NVDA: 100 }, buyCandidates: buys, sumarCandidates: sumar }, c, { amountUsd: 40_000 });

  it("con una objeción no entra, lo dice, y su lugar va al núcleo", () => {
    const p = cuarenta([compra("GFI", 1.2, { verdict: "objecion", reason: "la licencia de Tarkwa vence en abril de 2027 y Ghana no respondió" }), compra("NVDA", 1.1, sin)]);
    expect(p.lines.some((l) => l.symbol === "GFI")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "GFI")!.reason).toMatch(/revisión antes de comprar encontró una objeción: la licencia de Tarkwa/);
    expect(p.lines.some((l) => l.symbol === "NVDA")).toBe(true);
    expect(p.reviewsPending ?? []).toEqual([]);
  });
  it("sin revisar todavía: no entra y queda en la lista de pendientes (lo que el plan compraría si pasa)", () => {
    const p = cuarenta([compra("APH", 1.3, null), compra("NVDA", 1.1, sin)]);
    expect(p.lines.some((l) => l.symbol === "APH")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "APH")!.reason).toMatch(/revisión antes de comprar pendiente/);
    expect(p.reviewsPending).toEqual(["APH"]);
  });
  it("'no pude verificar' tampoco deja comprar; sin revisor (undefined) no se exige", () => {
    const p = cuarenta([compra("APH", 1.3, { verdict: "no_pude_verificar", reason: "no encontré el comunicado" })]);
    expect(p.leftOut!.find((x) => x.symbol === "APH")!.reason).toMatch(/no pudo verificar/);
    const q = cuarenta([compra("APH", 1.3, undefined)]);
    expect(q.lines.some((l) => l.symbol === "APH")).toBe(true);
  });
  it("un SUMAR también pasa por la revisión: pendiente o con objeción, no se suma", () => {
    const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 380, target: 498, verification: apta, atr: 11 };
    const pendiente = cuarenta([], [{ ...tsm, review: null }]);
    expect(pendiente.lines.some((l) => l.symbol === "TSM")).toBe(false);
    expect(pendiente.reviewsPending).toEqual(["TSM"]);
    const ok = cuarenta([], [{ ...tsm, review: sin }]);
    expect(ok.lines.find((l) => l.symbol === "TSM")!.kind).toBe("sumar");
  });
});

describe("convicción negativa y ETF satélite (15/9)", () => {
  /*
   * El 15/9 el Radar tenía una sola acción en COMPRAR, PBT, con convicción −0,98: distribución de USD 0,0187 por unidad,
   * Waddell Ranch sin ingresos y una fusión pendiente. Era "1° por convicción" por ser la única. Y como no estaba
   * verificada, su lugar lo tomaba CIBR, un ETF de ciberseguridad, con 8.000 de 40.000. Aprobado por el dueño: la
   * convicción negativa no entra, y el lugar de una acción que quedó afuera va al núcleo, no a un ETF.
   */
  type Buy = PlanInput["buyCandidates"][number];
  const apta = { verdict: "apto" as const, reason: "ok", current: true };
  const pbt = (over: Partial<Buy> = {}): Buy => ({ symbol: "PBT", kind: "stock", priority: -0.98, score: -0.4, sizeUsd: 20_000, close: 35.58, entryHigh: 36.29, stop: 32.52, target: 43.83, verification: apta, atr: 1, ...over });
  const cibr: Buy = { symbol: "CIBR", kind: "etf", priority: 1.1, score: null, sizeUsd: null, close: 100.05, entryHigh: 102.05, stop: 92.5, target: 121.15, atr: 2 };
  const cuarenta = (buys: Buy[]) => planContribution({ ...base, closes: { ...base.closes, PBT: 35.58, CIBR: 100.05 }, buyCandidates: buys }, c, { amountUsd: 40_000 });
  const nucleo = (p: ReturnType<typeof planContribution>) => p.lines.filter((l) => l.kind === "nucleo").reduce((t, l) => t + l.amountUsd, 0);

  it("PBT: una acción con convicción negativa no entra aunque sea la única, y su lugar va al núcleo", () => {
    const p = cuarenta([pbt()]);
    expect(p.lines.some((l) => l.symbol === "PBT")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "PBT")!.reason).toMatch(/convicción negativa \(−0,98\)/);
    expect(nucleo(p)).toBe(40_000);
  });
  it("CIBR: si una acción quedó afuera (pendiente de verificación), el ETF satélite no toma su lugar", () => {
    const p = cuarenta([pbt({ priority: 0.8, verification: null }), cibr]);
    expect(p.lines.some((l) => l.symbol === "CIBR")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "CIBR")!.reason).toMatch(/lugar libre era de una acción que quedó afuera/);
    expect(nucleo(p)).toBe(40_000);
  });
  it("tampoco con la acción afuera por convicción negativa: el lugar va al núcleo", () => {
    const p = cuarenta([pbt(), cibr]);
    expect(p.lines.some((l) => l.symbol === "CIBR")).toBe(false);
    expect(nucleo(p)).toBe(40_000);
  });
  it("sin ninguna acción candidata, el ETF satélite sí puede entrar (el lugar no era de nadie)", () => {
    const p = cuarenta([cibr]);
    expect(p.lines.find((l) => l.symbol === "CIBR")!.kind).toBe("comprar");
  });
});

