import { describe, expect, it } from "vitest";
import { planContribution, verificationBlock, verificationCaution, verificationLabel, type EtfConfig, type PlanInput } from "../index.js";

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
    const miles = (n: number) => Math.round(n).toLocaleString("es-AR");
    expect(nota).toContain(`USD ${miles(Math.round(p.totalUsd) - Math.round(amd.amountUsd))} de USD ${miles(p.totalUsd)}`);
    expect(nota).toContain("AMD: orden limitada en 150");
    expect(nota).toContain("no van a mercado");
  });

  it("esperar confirmación NO es una orden limitada: el nivel está arriba del precio y se compra si cierra arriba (15/9)", () => {
    const confirma = { state: "esperar_confirmacion" as const, level: 58.6, levelLabel: "máximo de 20 ruedas", low: 58.6, high: 59.77, validSessions: 10, sma20: 57, sma50: 56, atr14: 0.65, extensionAtr: 0, rangePct60: 40, why: "bajo su máximo" };
    const p = planContribution({ ...base, buyCandidates: [{ symbol: "NVDA", kind: "stock", priority: 1.5, score: 1.5, sizeUsd: 9_000, close: 180, stop: 170, entry: { ...confirma, level: 185, low: 185, high: 187 } }] }, c);
    const nota = p.notes.find((n) => n.startsWith("Hoy se ejecutan"))!;
    expect(nota).toContain("NVDA: comprar si cierra arriba de 185");
    expect(nota).not.toMatch(/NVDA: orden limitada/);
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

    it("18/9: verificada con el cuestionario anterior entra, con el aviso en la línea, y queda anotada para verificarse", () => {
      const p = cuarenta([stock("NBN", 1.63, { ...apta, current: false }), stock("APH", 1.58, apta)]);
      expect(p.lines.find((l) => l.symbol === "NBN")!.rationale).toMatch(/⚠ verificación hecha con el cuestionario anterior/);
      expect(p.lines.find((l) => l.symbol === "APH")!.rationale).not.toMatch(/⚠/);
      expect(p.verificationsPending).toEqual(["NBN"]);
    });
    it("18/9: 'evitar' sigue frenando, también con el cuestionario anterior", () => {
      const p = cuarenta([stock("NBN", 1.63, { verdict: "evitar", reason: "la ganancia es un crédito fiscal comprado", current: false }), stock("APH", 1.58, apta)]);
      expect(p.lines.some((l) => l.symbol === "NBN")).toBe(false);
      expect(p.leftOut!.find((x) => x.symbol === "NBN")!.reason).toMatch(/verificación web dice evitar: la ganancia es un crédito fiscal comprado/);
    });
    it("si ninguna la reemplaza, el lugar no lo toma un ETF ni se reparte: va al núcleo y la nota lo dice", () => {
      const lleno = cuarenta([stock("NBN", 1.63, apta), stock("APH", 1.58, apta), stock("NVDA", 1.44, apta), stock("LNC", 1.33, apta)]);
      // Desde el 18/9 lo único que la verificación frena por sí sola es "evitar".
      const vacio = cuarenta([stock("NBN", 1.63, { verdict: "evitar", reason: "sorpresa por impuestos", current: true }), stock("APH", 1.58, apta), stock("NVDA", 1.44, apta), stock("LNC", 1.33, apta), stock("GFI", 0.9, { verdict: "evitar", reason: "licencia de Tarkwa", current: true })]);
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
    it("AES del 16/9: una empresa bajo oferta de compra no entra al plan aunque el puntaje y la técnica la aprueben", () => {
      // Objetivo 15,93 "al doble del riesgo" contra una fusión en efectivo a 15,00 ya votada: el retorno está
      // topado por contrato y lo que queda son 1,28%, contra 5,01% del bono a 10 años sin riesgo de ruptura.
      const p = cuarenta([{ ...stock("AES", 1.63, apta), flags: ["bajo_oferta_de_compra"] }, stock("APH", 1.58, apta)]);
      expect(p.leftOut!.find((x) => x.symbol === "AES")!.reason).toMatch(/oferta de compra/);
      expect(p.lines.some((l) => l.symbol === "AES")).toBe(false);
    });
    it("18/9: con la verificación pendiente entra, la línea lo dice y el plan la anota para verificarla", () => {
      const p = cuarenta([stock("SMCI", 1.63, null), stock("APH", 1.58, apta)], { closes: { ...base.closes, SMCI: 40, APH: 84, XLF: 57 } });
      expect(p.lines.find((l) => l.symbol === "SMCI")!.rationale).toMatch(/⚠ verificación web pendiente/);
      expect(p.verificationsPending).toEqual(["SMCI"]);
    });
    it("18/9, TSM: con reservas entra y la reserva va escrita en la línea; el monto no cambia por el aviso", () => {
      const reservas = { verdict: "con_reservas" as const, reason: "venta neta de acciones por parte de insiders en los últimos 12 meses", current: true };
      const conAviso = cuarenta([stock("TSM", 1.2, reservas), stock("APH", 1.58, apta)], { closes: { ...base.closes, TSM: 430, APH: 84, XLF: 57 } });
      const sinAviso = cuarenta([stock("TSM", 1.2, apta), stock("APH", 1.58, apta)], { closes: { ...base.closes, TSM: 430, APH: 84, XLF: 57 } });
      const linea = conAviso.lines.find((l) => l.symbol === "TSM")!;
      expect(linea.kind).toBe("comprar");
      expect(linea.rationale).toMatch(/⚠ verificación web con reservas: venta neta de acciones por parte de insiders/);
      expect(linea.amountUsd).toBe(sinAviso.lines.find((l) => l.symbol === "TSM")!.amountUsd);
      // Ya está verificada con el cuestionario vigente: no hay nada que volver a buscar.
      expect(conAviso.verificationsPending).toEqual([]);
    });
    it("18/9: un SUMAR con reservas se suma con el aviso; con 'evitar' no se suma y su parte va al núcleo", () => {
      const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 413.63, target: 498.44 };
      const sano = cuarenta([], { sumarCandidates: [{ ...tsm, verification: apta }] });
      const conReservas = cuarenta([], { sumarCandidates: [{ ...tsm, verification: { verdict: "con_reservas", reason: "prima del ADR", current: true } }] });
      const evitar = cuarenta([], { sumarCandidates: [{ ...tsm, verification: { verdict: "evitar", reason: "guía retirada", current: true } }] });
      expect(sano.lines.some((l) => l.symbol === "TSM" && l.kind === "sumar")).toBe(true);
      expect(conReservas.lines.find((l) => l.symbol === "TSM")!.rationale).toMatch(/⚠ verificación web con reservas: prima del ADR/);
      expect(nucleo(conReservas)).toBe(nucleo(sano));
      expect(evitar.lines.some((l) => l.symbol === "TSM")).toBe(false);
      expect(evitar.notes.join(" ")).toMatch(/No se sumó TSM: verificación web dice evitar/);
      expect(nucleo(evitar)).toBeGreaterThan(nucleo(sano));
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
   * Hasta el 17/9 solo "sin objeciones" dejaba comprar. El 18/9 el dueño aprobó que las dos compuertas de IA avisen
   * en vez de bloquear: la tabla de revisiones tenía CERO filas (nunca había corrido), pide una búsqueda por acción y
   * por día a un modelo gratis saturado, y con la verificación arreglada APH, SMCI, NVDA y PGY pasaban y el plan igual
   * compraba solo núcleo por "revisión pendiente". Sigue frenando una objeción (que por construcción trae fuente);
   * "pendiente" y "no pude verificar" van escritos en la línea y decide él.
   */
  type Buy = PlanInput["buyCandidates"][number];
  const apta = { verdict: "apto" as const, reason: "ok", current: true };
  const sin = { verdict: "sin_objeciones" as const, reason: "sin objeciones" };
  const compra = (symbol: string, priority: number, review: Buy["review"]): Buy => ({ symbol, kind: "stock", priority, score: priority, sizeUsd: 20_000, close: 100, entryHigh: 102, stop: 90, target: 126, verification: apta, atr: 2, review });
  const cuarenta = (buys: Buy[], sumar: PlanInput["sumarCandidates"] = []) => planContribution({ ...base, closes: { ...base.closes, APH: 100, GFI: 100, NVDA: 100 }, buyCandidates: buys, sumarCandidates: sumar }, c, { amountUsd: 40_000 });

  it("18/9, APH y SMCI: con una objeción entra igual, con la objeción escrita en la línea; el monto no cambia por el aviso", () => {
    // La revisión corrió por primera vez el 18/9 a las 12:19 y objetó a las dos únicas acciones del plan, dos minutos
    // después de que entraran: APH por ventas del CEO y el CFO (USD 172 M en 90 días) y SMCI por una "investigación" de
    // un estudio de abogados. A un modelo al que se le pide "buscá razones para no comprarla" siempre le aparece algo:
    // sirve como información y frena todo como compuerta. Aprobado por el dueño: la objeción avisa, con su texto.
    const objecion = { verdict: "objecion" as const, reason: "el CEO y el CFO vendieron USD 172,3 M en acciones en 90 días" };
    const p = cuarenta([compra("APH", 1.2, objecion), compra("NVDA", 1.1, sin)]);
    const q = cuarenta([compra("APH", 1.2, sin), compra("NVDA", 1.1, sin)]);
    const aph = p.lines.find((l) => l.symbol === "APH")!;
    expect(aph.kind).toBe("comprar");
    expect(aph.avisos).toEqual(["la revisión antes de comprar encontró una objeción: el CEO y el CFO vendieron USD 172,3 M en acciones en 90 días"]);
    expect(aph.rationale).toMatch(/⚠ la revisión antes de comprar encontró una objeción: el CEO y el CFO vendieron/);
    expect(aph.amountUsd).toBe(q.lines.find((l) => l.symbol === "APH")!.amountUsd);
    // Ya está revisada: no queda anotada para revisarse de nuevo.
    expect(p.reviewsPending ?? []).toEqual([]);
  });
  it("18/9, APH: sin revisar todavía entra, la línea lo dice, y queda en la lista para que la revisión corra", () => {
    const p = cuarenta([compra("APH", 1.3, null), compra("NVDA", 1.1, sin)]);
    expect(p.lines.find((l) => l.symbol === "APH")!.rationale).toMatch(/⚠ revisión antes de comprar pendiente/);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.rationale).not.toMatch(/⚠/);
    expect(p.reviewsPending).toEqual(["APH"]);
    // La nota ya no dice que el plan no se ejecuta: dice qué pasa si la revisión encuentra algo.
    expect(p.notes.join(" ")).toMatch(/Revisión antes de comprar pendiente: APH\..*si encuentra una objeción.*queda escrita/);
    expect(p.notes.join(" ")).not.toMatch(/sale del plan/);
    expect(p.notes.join(" ")).not.toMatch(/el plan no se ejecuta/);
  });
  it("18/9: 'no pude verificar' entra con el aviso; sin revisor (undefined) no se exige ni se avisa", () => {
    const p = cuarenta([compra("APH", 1.3, { verdict: "no_pude_verificar", reason: "no encontré el comunicado" })]);
    expect(p.lines.find((l) => l.symbol === "APH")!.rationale).toMatch(/⚠ la revisión antes de comprar no pudo verificar: no encontré el comunicado/);
    expect(p.reviewsPending ?? []).toEqual([]);
    const q = cuarenta([compra("APH", 1.3, undefined)]);
    expect(q.lines.find((l) => l.symbol === "APH")!.rationale).not.toMatch(/⚠/);
  });
  it("18/9: los avisos de la IA van también como dato de la línea, para que toda pantalla que diga COMPRAR los muestre", () => {
    const p = cuarenta([{ ...compra("APH", 1.3, null), verification: { verdict: "con_reservas", reason: "guía que no sube", current: true } }, compra("NVDA", 1.1, sin)]);
    expect(p.lines.find((l) => l.symbol === "APH")!.avisos).toEqual(["verificación web con reservas: guía que no sube", "revisión antes de comprar pendiente"]);
    expect(p.lines.find((l) => l.symbol === "NVDA")!.avisos).toBeUndefined();
    const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 380, target: 498, verification: apta, atr: 11 };
    expect(cuarenta([], [{ ...tsm, review: null }]).lines.find((l) => l.symbol === "TSM")!.avisos).toEqual(["revisión antes de comprar pendiente"]);
  });
  it("18/9, TSM: si ya la tenés y Cartera dice REVISAR o VENDER, el plan no la compra como nueva: dos pantallas no pueden decir cosas opuestas", () => {
    // El 18/9 Cartera decía "TSM: REVISAR — la verificación web tiene reservas. No sumes hasta resolver esto" y, con
    // las compuertas avisando, el plan iba a decir "COMPRAR TSM USD 4.741". Para lo que ya tenés manda Cartera.
    const p = cuarenta([{ ...compra("TSM", 1.3, sin), cartera: { verb: "REVISAR", reason: "la verificación web del 2026-09-15 tiene reservas" } }, compra("NVDA", 1.1, sin)]);
    expect(p.lines.some((l) => l.symbol === "TSM")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "TSM")!.reason).toBe("1° por convicción: ya la tenés y Cartera dice REVISAR (la verificación web del 2026-09-15 tiene reservas): no se compra más hasta resolverlo");
    expect(p.lines.some((l) => l.symbol === "NVDA")).toBe(true);
    // No se gasta una revisión ni una verificación en lo que igual queda afuera.
    const q = cuarenta([{ ...compra("TSM", 1.3, null), verification: null, cartera: { verb: "VENDER", reason: "cerró bajo su stop" } }]);
    expect(q.reviewsPending ?? []).toEqual([]);
    expect(q.verificationsPending ?? []).toEqual([]);
    // Con MANTENER o SUMAR en Cartera no hay contradicción: entra como cualquier otra.
    expect(cuarenta([{ ...compra("TSM", 1.3, sin), cartera: { verb: "MANTENER", reason: "dejá correr" } }]).lines.some((l) => l.symbol === "TSM")).toBe(true);
  });
  it("18/9: lo anotado para revisar o verificar son solo líneas que quedaron en el plan, no lo que entró y después se cayó", () => {
    // Una línea elegida puede caerse después (monto menor a USD 100, o sin stop): si queda anotada, la app gasta una
    // búsqueda en algo que no compra y la nota dice "pendiente: X" mientras la tabla de afuera muestra a X excluida.
    const chica = cuarenta([{ ...compra("APH", 1.3, null), verification: null, sizeUsd: 50 }, compra("NVDA", 1.1, sin)]);
    expect(chica.lines.some((l) => l.symbol === "APH")).toBe(false);
    expect(chica.reviewsPending ?? []).toEqual([]);
    expect(chica.verificationsPending ?? []).toEqual([]);
    expect(chica.notes.join(" ")).not.toMatch(/Revisión antes de comprar pendiente/);
    const sinStop = cuarenta([{ ...compra("APH", 1.3, null), verification: null, stop: null }, compra("NVDA", 1.1, sin)]);
    expect(sinStop.lines.some((l) => l.symbol === "APH")).toBe(false);
    expect(sinStop.reviewsPending ?? []).toEqual([]);
    expect(sinStop.verificationsPending ?? []).toEqual([]);
  });
  it("18/9: una de tu lista de seguimiento también lleva sus avisos como dato", () => {
    const v: Buy = { ...compra("V", -2, null), kind: "watch", verification: { verdict: "con_reservas", reason: "investigación antimonopolio", current: true } };
    const linea = cuarenta([v]).lines.find((l) => l.symbol === "V")!;
    expect(linea.kind).toBe("seguimiento");
    expect(linea.avisos).toEqual(["verificación web con reservas: investigación antimonopolio", "revisión antes de comprar pendiente"]);
  });
  it("21/9, SMCI: una investigación regulatoria abierta y un objetivo muy arriba del consenso van al lado de COMPRAR, antes que los avisos de la IA", () => {
    const p = cuarenta([{ ...compra("SMCI", 1.3, null), flags: ["sorpresa_positiva", "investigacion_abierta", "objetivo_sobre_consenso"] }]);
    const l = p.lines.find((x) => x.symbol === "SMCI")!;
    expect(l.avisos).toEqual(["investigación regulatoria abierta: un titular puede abrir con un salto por debajo del stop (el hecho y su fuente están en la ficha)", "el objetivo de la app está 15% o más arriba del consenso de analistas", "revisión antes de comprar pendiente"]);
    expect(l.rationale).toMatch(/⚠ investigación regulatoria abierta/);
  });
  it("18/9: los dos avisos juntos van en la misma línea, después de las salvedades que ya tenía", () => {
    const p = cuarenta([{ ...compra("APH", 1.3, null), verification: { verdict: "con_reservas", reason: "guía que no sube", current: true }, cautions: ["se mueve como TSM que ya tenés (correlación 0.81)"] }]);
    expect(p.lines.find((l) => l.symbol === "APH")!.rationale).toMatch(/⚠ se mueve como TSM.* · ⚠ verificación web con reservas: guía que no sube · ⚠ revisión antes de comprar pendiente$/);
  });
  it("un SUMAR también pasa por la revisión: con objeción o pendiente se suma con el aviso (18/9)", () => {
    const tsm = { symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 380, target: 498, verification: apta, atr: 11 };
    const pendiente = cuarenta([], [{ ...tsm, review: null }]);
    expect(pendiente.lines.find((l) => l.symbol === "TSM")!.rationale).toMatch(/⚠ revisión antes de comprar pendiente/);
    expect(pendiente.reviewsPending).toEqual(["TSM"]);
    const objecion = cuarenta([], [{ ...tsm, review: { verdict: "objecion", reason: "rebaja de Morgan Stanley el 12/9" } }]);
    expect(objecion.lines.find((l) => l.symbol === "TSM")!.avisos).toEqual(["la revisión antes de comprar encontró una objeción: rebaja de Morgan Stanley el 12/9"]);
    expect(objecion.notes.join(" ")).not.toMatch(/No se sumó TSM/);
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
  it("CIBR: si una acción quedó afuera (la verificación dice evitar), el ETF satélite no toma su lugar", () => {
    const p = cuarenta([pbt({ priority: 0.8, verification: { verdict: "evitar", reason: "Waddell Ranch sin ingresos", current: true } }), cibr]);
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

describe("auditoría del 15/9: una posición que no se suma tiene un solo motivo", () => {
  it("TSM: no se suma porque QQQ está en OBSERVAR, y no aparece además como compra nueva 'con reservas'", () => {
    const p = planContribution({
      ...base,
      sumarCandidates: [{ symbol: "TSM", valueUsd: 7_000, weightPct: 7, stop: 412.81, target: 470, caution: "el ETF de su tema (QQQ) está en OBSERVAR: bajo su stop dinámico" }],
      buyCandidates: [{ symbol: "TSM", kind: "stock", priority: 1.2, score: 1.2, sizeUsd: 9_000, close: 428, stop: 412.81, verification: { verdict: "con_reservas", reason: "valuación", current: true } }],
    }, c);
    expect(p.leftOut?.some((x) => x.symbol === "TSM") ?? false).toBe(false);
    expect(p.notes.filter((n) => n.includes("TSM"))).toEqual([expect.stringMatching(/^No se sumó TSM: el ETF de su tema \(QQQ\)/)]);
    expect(p.lines.some((l) => l.symbol === "TSM")).toBe(false);
  });
  it("una posición que ya tiene su peso no se suma, y la nota lo dice", () => {
    const p = planContribution({ ...base, sumarCandidates: [{ symbol: "GGAL", valueUsd: 28_000, weightPct: 28, stop: 50, target: 80, caution: null }] }, c);
    expect(p.lines.some((l) => l.symbol === "GGAL")).toBe(false);
    expect(p.notes.some((n) => /^No se sumó GGAL: ya tiene su peso/.test(n))).toBe(true);
  });
});

describe("auditoría del 15/9: los datos de entrada dicen lo mismo que el motivo", () => {
  it("con reservas y con el cuestionario anterior: el dato dice 'con_reservas', como el motivo (LNC y DEC)", () => {
    expect(verificationLabel({ verdict: "con_reservas", reason: "x", current: false })).toBe("con_reservas");
    // Desde el 18/9 "con reservas" no frena: el mismo texto va como aviso en la línea, y solo "evitar" bloquea.
    expect(verificationCaution({ verdict: "con_reservas", reason: "x", current: false })).toMatch(/con reservas/);
    expect(verificationBlock({ verdict: "con_reservas", reason: "x", current: false })).toBeNull();
    expect(verificationBlock({ verdict: "evitar", reason: "x", current: false })).toMatch(/dice evitar/);
    expect(verificationLabel({ verdict: "apto", reason: "x", current: false })).toBe("anterior");
    expect(verificationLabel({ verdict: "apto", reason: "x", current: true })).toBe("apto");
    expect(verificationLabel(null)).toBe("pendiente");
    expect(verificationLabel(undefined)).toBeNull();
  });
});

describe("auditoría del 15/9: una orden, una base, y el motivo definitivo primero", () => {
  type Buy = PlanInput["buyCandidates"][number];
  const apta = { verdict: "apto" as const, reason: "ok", current: true };
  const compra = (symbol: string, priority: number, extra: Partial<Buy> = {}): Buy => ({ symbol, kind: "stock", priority, score: priority, sizeUsd: 20_000, close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, verification: apta, atr: 2, ...extra });
  const cuarenta = (buys: Buy[]) => planContribution({ ...base, closes: { ...base.closes, SNDK: 100, NBN: 100, BLBD: 100, SEZL: 100, PAM: 86.65, XLF: 57.03 }, buyCandidates: buys }, c, { amountUsd: 40_000 });

  it("SNDK y NBN: el motivo que se muestra es la regla que igual la frena, no 'verificación pendiente'", () => {
    const p = cuarenta([compra("SNDK", 1.45, { verification: null, flags: ["subio_mucho_12m"] }), compra("NBN", 0.95, { verification: { ...apta, current: false }, flags: ["banco_sin_estados"] })]);
    expect(p.leftOut!.find((x) => x.symbol === "SNDK")!.reason).toMatch(/subió más de 100%/);
    expect(p.leftOut!.find((x) => x.symbol === "NBN")!.reason).toMatch(/banco sin estados/);
    // Y no se gasta cuota verificando lo que igual queda afuera.
    expect(p.verificationsPending).toEqual([]);
  });
  it("BLBD y SEZL: les falta la verificación vigente; desde el 18/9 entran con el aviso y el plan las anota para que se verifiquen", () => {
    const p = cuarenta([compra("BLBD", 1.01, { verification: null }), compra("SEZL", 1.08, { verification: { ...apta, current: false } })]);
    expect(p.verificationsPending).toEqual(["SEZL", "BLBD"]);
    expect(p.lines.find((l) => l.symbol === "BLBD")!.rationale).toMatch(/⚠ verificación web pendiente/);
    expect(p.lines.find((l) => l.symbol === "SEZL")!.rationale).toMatch(/⚠ verificación hecha con el cuestionario anterior/);
  });
  it("PAM: esperando un retroceso, el stop se mide contra el piso de la franja (81,96), no contra el cierre (86,65)", () => {
    const retroceso = { state: "esperar_retroceso" as const, level: 82.79, levelLabel: "media de 20 ruedas", low: 81.96, high: 82.79, validSessions: 15, sma20: 82.79, sma50: 80, atr14: 2.33, extensionAtr: 2, rangePct60: 80, why: "estirada" };
    const p = cuarenta([compra("PAM", 0.4, { close: 86.65, entryLow: 81.96, entryHigh: 82.79, stop: 81.88, target: 84.61, atr: 2.33, entry: retroceso })]);
    expect(p.lines.some((l) => l.symbol === "PAM")).toBe(false);
    expect(p.leftOut!.find((x) => x.symbol === "PAM")!.reason).toMatch(/piso de la franja \(81,96\) está a 0,0 ATR del stop \(81,88\)/);
  });
  it("XLF: esperando confirmación, el piso es el disparo (58,60): a 3 ATR del stop no está en el ruido", () => {
    const xlf: Buy = { symbol: "XLF", kind: "etf", priority: 1.1, score: null, sizeUsd: null, close: 57.03, entryLow: 58.6, entryHigh: 59.77, stop: 56.65, target: 65.99, atr: 0.65 };
    const p = cuarenta([xlf]);
    expect(p.leftOut?.find((x) => x.symbol === "XLF")?.reason ?? "").not.toMatch(/ruido/);
    expect(p.lines.find((l) => l.symbol === "XLF")!.minPrice).toBe(57.3);
  });
  it("tramos: la nota los reparte sin perder un dólar y cada línea trae su primer tramo y su cantidad", () => {
    const p = cuarenta([]);
    expect(p.notes.join(" ")).toMatch(/3 tramos: USD 13\.333, 13\.333 y 13\.334/);
    const vti = p.lines.find((l) => l.symbol === "VTI")!;
    expect(vti.trancheUsd).toBe(Math.floor(vti.amountUsd / 3));
    expect(vti.orderPrice).toBe(300);
    expect(vti.qty).toBe(Math.floor(vti.amountUsd / 300));
    expect(vti.trancheQty).toBe(Math.floor(vti.trancheUsd! / 300));
  });
  it("una acción del plan mide su cantidad contra el techo de la franja: nunca gasta de más", () => {
    const p = cuarenta([compra("BLBD", 1.01, { close: 62.41, entryLow: 64.6, entryHigh: 65.89, stop: 59.29, target: 79.09, atr: 1.5, review: undefined })]);
    const l = p.lines.find((x) => x.symbol === "BLBD")!;
    expect(l.orderPrice).toBe(65.89);
    expect(l.qty).toBe(Math.floor(l.amountUsd / 65.89));
  });
  it("el núcleo dice lo que recibe de verdad: 40.000 de 40.000, con los lugares vacíos, aunque no entre ninguna acción", () => {
    // Varias COMPRAR y ninguna entra. El 15/9 alcanzaba con que no estuvieran verificadas; desde el 18/9 solo "evitar" frena.
    const p = cuarenta(["BLBD", "SEZL", "LNC", "DEC", "APH"].map((s, k) => compra(s, 1.2 - k / 10, { verification: { verdict: "evitar", reason: "x", current: true } })));
    const vti = p.lines.find((l) => l.symbol === "VTI")!;
    expect(vti.rationale).toMatch(/USD 40\.000 de 40\.000 \(100%\)/);
    expect(vti.rationale).toMatch(/lugares vacíos/);
    expect(p.notes.join(" ")).toMatch(/4 lugares de posiciones nuevas quedaron vacíos/);
    expect(p.lines.filter((l) => l.kind === "nucleo").reduce((t, l) => t + l.amountUsd, 0)).toBe(40_000);
  });
});

