import { PLAN_BLOCKERS, verificationOrder, type CandidateVerifier, type PreTradeReviewer } from "@thesis/core";
import { CUESTIONARIO_AGENTE, RevisionAgenteSchema, VerificacionAgenteSchema, dictamenDeRevision, dictamenDeVerificacion } from "@thesis/reasoner";
import { VERIFY_FRESH_DAYS } from "./radar-verify.js";
import type { RadarDeps } from "./radar.js";

/**
 * Verificación por agente (22/9, spec 2026-09-22-verificacion-por-agente). `pendientesDelAgente` arma lo que el agente de
 * Claude tiene que verificar y revisar hoy; `importarDelAgente` valida lo que devuelve, decide por regla y guarda en las
 * tablas de siempre. El agente no toca la base: estas dos son su única puerta.
 */
type Store = Pick<RadarDeps["store"], "latestCandidates" | "latestPlan" | "allTags" | "verification" | "preTradeReviews" | "profile" | "saveVerification" | "savePreTradeReview">;
const DAY = 86_400_000;
const edadDias = (desde: string, hasta: string) => (Date.parse(hasta) - Date.parse(desde)) / DAY;
const unicos = (xs: string[]) => [...new Set(xs.map((s) => s.toUpperCase()))];

export interface PendientesDelAgente {
  hoy: string;
  version: string;
  versionRevision: string;
  cuestionario: string;
  verificar: Array<{ symbol: string; nombre: string | null; contexto: string }>;
  revisar: Array<{ symbol: string; nombre: string | null; verificacion: { verdict: string; reason: string; date: string } | null; linea: { kind: string; close: number | null; stop: number | null } }>;
}

export async function pendientesDelAgente(deps: { store: Store; verifier?: CandidateVerifier | null; reviewer?: PreTradeReviewer | null }, opts: { today: string; topeVerificaciones: number; topeRevisiones: number; simbolos?: string[] }): Promise<PendientesDelAgente> {
  const { store } = deps;
  const version = deps.verifier?.promptVersion ?? "";
  const versionRevision = deps.reviewer?.promptVersion ?? "";
  const filas = await store.latestCandidates();
  const porSimbolo = new Map(filas.map((f) => [f.symbol.toUpperCase(), f]));
  const plan = await store.latestPlan().catch(() => null);
  // Los ETFs no se verifican ni se revisan (el plan no los exige): una línea de ETF no gasta un lugar del agente.
  const lineas = (plan?.lines ?? []).filter((l) => l.kind !== "nucleo" && porSimbolo.get(l.symbol.toUpperCase())?.kind !== "etf");
  const nombre = async (s: string) => (await store.profile(s).catch(() => null))?.profile.name ?? null;

  let aVerificar: string[];
  let aRevisar: string[];
  if (opts.simbolos?.length) {
    // A mano: esos símbolos, en las dos listas, sin topes ni vigencia (para probar o para pedir uno puntual).
    aVerificar = unicos(opts.simbolos);
    aRevisar = aVerificar;
  } else {
    const vigente = async (s: string) => {
      const v = await store.verification(s).catch(() => null);
      return !!v && v.promptVersion === version && edadDias(v.date, opts.today) < VERIFY_FRESH_DAYS;
    };
    const comprables = verificationOrder(filas.filter((f) => (f.kind === "stock" || f.kind === "watch") && f.verdict === "COMPRAR" && !f.flags.some((x) => PLAN_BLOCKERS[x])), await store.allTags());
    const orden = unicos([...lineas.map((l) => l.symbol), ...(plan?.verificationsPending ?? []), ...comprables.map((f) => f.symbol)]);
    aVerificar = [];
    for (const s of orden) {
      if (aVerificar.length >= opts.topeVerificaciones) break;
      if (!(await vigente(s))) aVerificar.push(s);
    }
    const revisadasHoy = new Set((await store.preTradeReviews(opts.today).catch(() => [])).filter((r) => r.promptVersion === versionRevision).map((r) => r.symbol.toUpperCase()));
    aRevisar = unicos(lineas.map((l) => l.symbol)).filter((s) => !revisadasHoy.has(s)).slice(0, opts.topeRevisiones);
  }

  const verificar = await Promise.all(aVerificar.map(async (s) => {
    const f = porSimbolo.get(s);
    return { symbol: s, nombre: await nombre(s), contexto: f ? `banderas del Radar: ${f.flags.join(", ") || "ninguna"}` : "no está en el Radar de hoy" };
  }));
  const revisar = await Promise.all(aRevisar.map(async (s) => {
    const f = porSimbolo.get(s);
    const l = lineas.find((x) => x.symbol.toUpperCase() === s);
    const v = await store.verification(s).catch(() => null);
    return { symbol: s, nombre: await nombre(s), verificacion: v ? { verdict: v.verdict, reason: v.reason, date: v.date } : null, linea: { kind: l?.kind ?? "comprar", close: l?.close ?? f?.close ?? null, stop: l?.stop ?? f?.stop ?? null } };
  }));
  return { hoy: opts.today, version, versionRevision, cuestionario: CUESTIONARIO_AGENTE, verificar, revisar };
}

export interface ImportacionDelAgente {
  verificados: Array<{ symbol: string; verdict: string; reason: string }>;
  revisados: Array<{ symbol: string; verdict: string; reason: string }>;
  rechazados: Array<{ symbol: string | null; motivo: string }>;
}

const simboloDe = (x: unknown): string | null => (x && typeof x === "object" && typeof (x as { symbol?: unknown }).symbol === "string" ? ((x as { symbol: string }).symbol).toUpperCase() : null);
const motivoZod = (e: { issues: Array<{ path: PropertyKey[]; message: string }> }) => e.issues.slice(0, 3).map((i) => `${i.path.map(String).join(".") || "(raíz)"}: ${i.message}`).join("; ");

/**
 * Valida cada ítem por separado (uno mal formado no tira el archivo), decide con la regla y guarda con la versión del agente
 * y la fecha de hoy. `ensayo`: decide y devuelve, sin escribir, para ver la salida antes de encender el cron.
 */
export async function importarDelAgente(store: Pick<Store, "saveVerification" | "savePreTradeReview">, archivo: unknown, opts: { hostsPrimarios: readonly string[]; today: string; version: string; versionRevision: string; ensayo?: boolean }): Promise<ImportacionDelAgente> {
  const out: ImportacionDelAgente = { verificados: [], revisados: [], rechazados: [] };
  const a = archivo as { verificaciones?: unknown; revisiones?: unknown } | null;
  if (!a || typeof a !== "object" || !Array.isArray(a.verificaciones)) {
    out.rechazados.push({ symbol: null, motivo: "el archivo tiene que ser { verificaciones: [...], revisiones: [...] }" });
    return out;
  }
  const detectedAt = new Date().toISOString();
  // Un archivo viejo no se reimporta: se guardaría con la fecha de hoy y extendería la vigencia de 7 días. Ayer todavía vale
  // por si la corrida cruza la medianoche.
  const ayer = new Date(Date.parse(opts.today) - 86_400_000).toISOString().slice(0, 10);
  const fechaMala = (fecha: string, que: string): string | null => (fecha > opts.today ? `${que} con fecha futura (${fecha})` : fecha < ayer ? `${que} con fecha vieja (${fecha}): no se reimporta` : null);
  for (const item of a.verificaciones) {
    const p = VerificacionAgenteSchema.safeParse(item);
    if (!p.success) { out.rechazados.push({ symbol: simboloDe(item), motivo: `verificación: ${motivoZod(p.error)}` }); continue; }
    const malaV = fechaMala(p.data.fecha, "verificación");
    if (malaV) { out.rechazados.push({ symbol: p.data.symbol.toUpperCase(), motivo: malaV }); continue; }
    const symbol = p.data.symbol.toUpperCase();
    const d = dictamenDeVerificacion(p.data, opts.hostsPrimarios);
    if (!opts.ensayo) await store.saveVerification({ ...d, symbol, date: opts.today, detectedAt, promptVersion: opts.version });
    out.verificados.push({ symbol, verdict: d.verdict, reason: d.reason });
  }
  for (const item of Array.isArray(a.revisiones) ? a.revisiones : []) {
    const p = RevisionAgenteSchema.safeParse(item);
    if (!p.success) { out.rechazados.push({ symbol: simboloDe(item), motivo: `revisión: ${motivoZod(p.error)}` }); continue; }
    const malaR = fechaMala(p.data.fecha, "revisión");
    if (malaR) { out.rechazados.push({ symbol: p.data.symbol.toUpperCase(), motivo: malaR }); continue; }
    const symbol = p.data.symbol.toUpperCase();
    const d = dictamenDeRevision(p.data);
    if (!opts.ensayo) await store.savePreTradeReview({ ...d, symbol, date: opts.today, promptVersion: opts.versionRevision });
    out.revisados.push({ symbol, verdict: d.verdict, reason: d.reason });
  }
  return out;
}
