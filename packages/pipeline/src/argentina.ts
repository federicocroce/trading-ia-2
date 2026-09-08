import type { ArgentinaConfig, Candle, CandidateRow, MacroAr, PriceHistory, RadarPolicy, Tags } from "@thesis/core";
import { cedearCheck, decideArStock, macroAr } from "@thesis/core";
import type { CarteraStore, RadarStore } from "./store.js";

/**
 * Argentina (etapa 3): refresco diario. Macro (dólares, brecha, riesgo país, Merval en USD),
 * acciones de BYMA contra el Merval y CEDEARs contra el CCL. Todo queda en la base:
 * velas, macro del día, filas de candidato (kind "ar" / "cedear") y etiquetas.
 */
export interface ArgentinaDeps {
  /** Velas (CarteraStore) + candidatos, etiquetas y macro (RadarStore). */
  store: CarteraStore & RadarStore;
  /** Yahoo: símbolos `.BA` en pesos y el índice Merval. */
  history: PriceHistory;
  macro: { dolares(): Promise<Partial<Record<"oficial" | "mep" | "ccl" | "blue" | "mayorista", number>>>; riesgoPais(): Promise<{ value: number; date: string } | null> };
  /** Último precio en EE.UU. de los subyacentes de los CEDEARs. */
  usPrices: (symbols: string[]) => Promise<Record<string, number>>;
  config: ArgentinaConfig;
  policy: RadarPolicy;
  log?: (msg: string) => void;
}

/** Referencia contra la que se miden las acciones argentinas (la medición no lee la config). */
export const AR_BENCHMARK = "^MERV";
const HISTORY_DAYS = 400;
const round2 = (n: number) => Math.round(n * 100) / 100;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

function baseRow(date: string, symbol: string, kind: CandidateRow["kind"], close: number): CandidateRow {
  return {
    candidateDate: date, symbol, kind, verdict: "OBSERVAR", score: null, axes: {}, peerGroup: [], rankInGroup: null, groupSize: null,
    close, entryLow: null, entryHigh: null, stop: null, target: null, sizeUsd: null, sizeQty: null, riskScore: null, flags: [], nthAppearance: 1,
    summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
    close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
  };
}

/** Etiqueta por regla; lo manual nunca se pisa. */
async function ensureTags(store: RadarStore, symbol: string, t: Tags): Promise<void> {
  const cur = await store.tags(symbol);
  if (cur?.themesSource === "manual") return;
  await store.saveTags(symbol, t);
}

export async function refreshArgentina(deps: ArgentinaDeps, opts: { today: string }): Promise<{ macro: MacroAr; acciones: number; cedears: number; errors: Array<{ symbol: string; error: string }> }> {
  const errors: Array<{ symbol: string; error: string }> = [];
  const { store, config } = deps;

  // 1. Merval: referencia de fuerza relativa y de medición.
  const merval = await deps.history.candles(config.benchmark, HISTORY_DAYS).catch((e) => { errors.push({ symbol: config.benchmark, error: errText(e) }); return [] as Candle[]; });
  if (merval.length) await store.upsertCandles(config.benchmark, merval);
  const mervalClose = merval[merval.length - 1]?.close ?? null;

  // 2. Macro del día. Si una fuente falla, se guarda lo que hay.
  let dolares: Awaited<ReturnType<ArgentinaDeps["macro"]["dolares"]>> = {};
  try {
    dolares = await deps.macro.dolares();
  } catch (e) {
    errors.push({ symbol: "macro", error: `dólares: ${errText(e)}` });
  }
  let riesgoPais: number | null = null;
  try {
    riesgoPais = (await deps.macro.riesgoPais())?.value ?? null;
  } catch (e) {
    errors.push({ symbol: "macro", error: `riesgo país: ${errText(e)}` });
  }
  const macro = macroAr({ date: opts.today, dolares, riesgoPais, merval: mervalClose });
  await store.saveMacroAr(macro);

  // 3. Acciones de BYMA contra el Merval.
  const previous = await store.latestCandidates();
  const rows: CandidateRow[] = [];
  let acciones = 0;
  for (const a of config.acciones) {
    try {
      const candles = await deps.history.candles(a.symbol, HISTORY_DAYS);
      if (!candles.length) throw new Error("sin velas");
      await store.upsertCandles(a.symbol, candles);
      const d = decideArStock(candles, merval, macro.ccl, deps.policy.technical);
      if ("excluded" in d) {
        deps.log?.(`[argentina] ${a.symbol} excluida: ${d.reasons.join(", ")}`);
        continue;
      }
      const prev = previous.find((p) => p.symbol === a.symbol);
      const nth = prev ? (prev.candidateDate === opts.today ? prev.nthAppearance : prev.nthAppearance + 1) : 1;
      rows.push({
        ...baseRow(opts.today, a.symbol, "ar", d.close),
        verdict: d.verdict,
        axes: { rs3m: d.rs3m, rs6m: d.rs6m, rs12m: d.rs12m, distSma200Pct: d.distSma200Pct, atrPct: d.atrPct, closeUsd: d.closeUsd },
        peerGroup: a.adr ? [a.adr] : [],
        entryLow: d.close, entryHigh: round2(d.close * 1.02), stop: d.stop, target: d.target,
        flags: d.reasons, nthAppearance: nth, spyClose: mervalClose,
      });
      const themes = [...new Set(["argentina", ...(a.themes ?? [])])];
      await ensureTags(store, a.symbol, { assetClass: "accion_ar", sector: a.sector, industry: null, themes, themesSource: "regla" });
      acciones++;
    } catch (e) {
      errors.push({ symbol: a.symbol, error: errText(e) });
    }
  }

  // 4. CEDEARs: dólar implícito contra el CCL. Sin CCL no hay chequeo.
  let cedears = 0;
  if (config.cedears.length) {
    if (macro.ccl === null) {
      for (const c of config.cedears) errors.push({ symbol: c.symbol, error: "sin CCL para el dólar implícito" });
    } else {
      const ccl = macro.ccl;
      const us = await deps.usPrices(config.cedears.map((c) => c.us)).catch((e) => { errors.push({ symbol: "cedears", error: `precios en EE.UU.: ${errText(e)}` }); return {} as Record<string, number>; });
      for (const c of config.cedears) {
        try {
          const candles = await deps.history.candles(c.symbol, 30);
          const baClose = candles[candles.length - 1]?.close;
          if (!baClose) throw new Error("sin precio local");
          await store.upsertCandles(c.symbol, candles);
          const usClose = us[c.us];
          if (!usClose) throw new Error(`sin precio de ${c.us} en EE.UU.`);
          const chk = cedearCheck(c, baClose, usClose, ccl);
          rows.push({ ...baseRow(opts.today, c.symbol, "cedear", baClose), axes: { ratio: c.ratio, impliedCcl: chk.impliedCcl, gapPct: chk.gapPct, priceUsd: chk.priceUsd, usClose }, peerGroup: [c.us], flags: [chk.flag] });
          const usTags = await store.tags(c.us);
          await ensureTags(store, c.symbol, { assetClass: "cedear", sector: usTags?.sector ?? "Otros", industry: usTags?.industry ?? null, themes: usTags?.themes ?? [], themesSource: "regla" });
          cedears++;
        } catch (e) {
          errors.push({ symbol: c.symbol, error: errText(e) });
        }
      }
    }
  }

  if (rows.length) await store.upsertCandidates(rows);
  return { macro, acciones, cedears, errors };
}
