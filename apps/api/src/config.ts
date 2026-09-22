import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ArgentinaConfigSchema, EtfConfigSchema, RadarPolicySchema, TaxonomyConfigSchema, type ArgentinaConfig, type EtfConfig, type RadarPolicy, type TaxonomyConfig } from "@thesis/core";

/** Configuración desde env + universe.json. Sin valores secretos hardcodeados. */
export interface Config {
  databaseUrl: string;
  reasoner: ReasonerConfig;
  alpaca: { keyId: string; secretKey: string; paper: true };
  userAgent: string;
  courtListenerToken: string | undefined;
  /** Perfil de empresa (país, industria) para el panel de riesgo. Opcional. */
  finnhubToken: string | undefined;
  port: number;
  minEdge: number;
  maxCandidates: number;
  capitalFallbackUsd: number;
  /** Cron de la corrida diaria (hora local del proceso). */
  dailyCron: string;
  /** Cron del veredicto de cartera (después de la corrida de tesis). */
  carteraCron: string;
  /** Radar: barrido semanal, refresco diario, plan mensual. */
  radarScanCron: string;
  radarRefreshCron: string;
  radarPlanCron: string;
  /** Chequeo automático de pasos pendientes al arrancar y cada 30 min (CATCHUP_AUTO=0 lo apaga). */
  catchupAuto: boolean;
  radar: RadarConfig;
  universe: Universe;
  csvPath: string;
  /** Quién verifica y revisa antes de comprar (22/9): el agente de Claude por cron (por defecto) o Gemini. */
  verificador: "agente" | "gemini";
}

export interface Universe {
  /** Tickers US a seguir en EDGAR/earnings. */
  us: string[];
  /** ADRs argentinos (allowlist del filtro). */
  adr: string[];
  /** ticker -> nombre legal para CourtListener. */
  legalNames: Record<string, string>;
}

export type ReasonerKind = "anthropic" | "gemini";
export interface ReasonerConfig {
  kind: ReasonerKind;
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** GOOGLE_AI_API_KEY_1..4, en orden, sin vacías. */
  geminiKeys: string[];
  /** GEMINI_MODELS separado por coma; undefined = default del reasoner. */
  geminiModels?: string[];
}

/**
 * Elige el razonador por lo que haya configurado. Sin REASONER: Anthropic si hay key,
 * si no Gemini si hay keys, si no error. REASONER=gemini|anthropic fuerza uno.
 */
export function resolveReasoner(env: Record<string, string | undefined>): ReasonerConfig {
  const geminiKeys = [1, 2, 3, 4].map((n) => env[`GOOGLE_AI_API_KEY_${n}`]?.trim()).filter((k): k is string => !!k);
  const anthropicApiKey = env["ANTHROPIC_API_KEY"]?.trim() || undefined;
  const models = env["GEMINI_MODELS"]?.split(",").map((m) => m.trim()).filter(Boolean);
  const forced = env["REASONER"]?.trim();
  let kind: ReasonerKind;
  if (forced === "gemini" || forced === "anthropic") kind = forced;
  else if (forced) throw new Error(`REASONER=${forced} desconocido (gemini|anthropic)`);
  else if (anthropicApiKey) kind = "anthropic";
  else if (geminiKeys.length) kind = "gemini";
  else throw new Error("razonador sin credenciales: configurá ANTHROPIC_API_KEY o GOOGLE_AI_API_KEY_1..4");
  if (kind === "gemini" && !geminiKeys.length) throw new Error("REASONER=gemini requiere GOOGLE_AI_API_KEY_1..4");
  if (kind === "anthropic" && !anthropicApiKey) throw new Error("REASONER=anthropic requiere ANTHROPIC_API_KEY");
  return {
    kind,
    geminiKeys,
    ...(anthropicApiKey ? { anthropicApiKey } : {}),
    ...(env["ANTHROPIC_MODEL"] ? { anthropicModel: env["ANTHROPIC_MODEL"] } : {}),
    ...(models?.length ? { geminiModels: models } : {}),
  };
}

/** VERIFICADOR=agente|gemini. Por defecto el agente: Gemini gratis se agotaba e inventaba datos (22/9). */
export function resolveVerificador(env: NodeJS.ProcessEnv): "agente" | "gemini" {
  const v = env["VERIFICADOR"]?.trim().toLowerCase();
  if (!v || v === "agente") return "agente";
  if (v === "gemini") return "gemini";
  throw new Error(`VERIFICADOR=${v} desconocido (agente|gemini)`);
}

export interface RadarConfig {
  taxonomy: TaxonomyConfig;
  etfs: EtfConfig[];
  policy: RadarPolicy;
  argentina: ArgentinaConfig;
  /** Días de decisión de la Fed (config/fomc.json): con una a 3 días hábiles o menos, el primer tramo va después. */
  fomc: string[];
  /** Hosts cuya URL vale como fuente primaria de un hecho externo (config/hechos-fuentes.json): reguladores y cables de comunicados. */
  hechosFuentes: string[];
  /** Topes diarios del agente de verificación (config/verificacion-agente.json, 22/9). */
  agente: { topeVerificaciones: number; topeRevisiones: number };
}

const FomcSchema = z.object({ decisiones: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)) });
const HechosFuentesSchema = z.object({ hostsPrimarios: z.array(z.string().min(1)) });
const AgenteSchema = z.object({ topeVerificaciones: z.number().int().min(0).max(40), topeRevisiones: z.number().int().min(0).max(20) });

/** Lee y valida config/taxonomia.json, config/etfs.json, config/radar-policy.json, config/argentina.json, config/fomc.json y config/hechos-fuentes.json. */
export async function loadRadarConfig(root: string): Promise<RadarConfig> {
  const read = async (name: string) => JSON.parse(await readFile(path.join(root, "config", name), "utf8")) as unknown;
  return {
    taxonomy: TaxonomyConfigSchema.parse(await read("taxonomia.json")),
    etfs: z.array(EtfConfigSchema).parse(await read("etfs.json")),
    policy: RadarPolicySchema.parse(await read("radar-policy.json")),
    argentina: ArgentinaConfigSchema.parse(await read("argentina.json")),
    fomc: FomcSchema.parse(await read("fomc.json")).decisiones,
    hechosFuentes: HechosFuentesSchema.parse(await read("hechos-fuentes.json")).hostsPrimarios,
    agente: AgenteSchema.parse(await read("verificacion-agente.json")),
  };
}

const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`env ${k} requerida`);
  return v;
};

/** Raíz del monorepo: sube desde cwd hasta encontrar pnpm-workspace.yaml. */
export async function findRoot(start = process.cwd()): Promise<string> {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    try {
      await readFile(path.join(dir, "pnpm-workspace.yaml"));
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  return start;
}

export async function loadConfig(root?: string): Promise<Config> {
  root ??= await findRoot();
  // .env de la raíz del repo, si existe. Las variables ya presentes en el entorno tienen prioridad.
  try {
    process.loadEnvFile(path.join(root, ".env"));
  } catch {
    /* sin .env: se usa solo el entorno */
  }
  const universePath = process.env["UNIVERSE_PATH"] ?? path.join(root, "config", "universe.json");
  const universe = JSON.parse(await readFile(universePath, "utf8")) as Universe;
  if (process.env["ALPACA_PAPER"] === "false") throw new Error("ALPACA_PAPER=false no permitido en v1");
  return {
    databaseUrl: req("DATABASE_URL"),
    reasoner: resolveReasoner(process.env),
    alpaca: { keyId: req("ALPACA_KEY_ID"), secretKey: req("ALPACA_SECRET_KEY"), paper: true },
    userAgent: process.env["SEC_USER_AGENT"] ?? "thesis-engine research contact@example.com",
    courtListenerToken: process.env["COURTLISTENER_TOKEN"],
    finnhubToken: process.env["FINNHUB_API_KEY"]?.trim() || undefined,
    port: Number(process.env["PORT"] ?? 3001),
    minEdge: Number(process.env["MIN_EDGE"] ?? 0.1),
    maxCandidates: Number(process.env["MAX_CANDIDATES"] ?? 8),
    capitalFallbackUsd: Number(process.env["CAPITAL_USD"] ?? 100_000),
    dailyCron: process.env["DAILY_CRON"] ?? "30 7 * * 1-5",
    carteraCron: process.env["CARTERA_CRON"] ?? "45 7 * * 1-5",
    radarScanCron: process.env["RADAR_SCAN_CRON"] ?? "0 20 * * 0",
    radarRefreshCron: process.env["RADAR_REFRESH_CRON"] ?? "50 7 * * 1-5",
    radarPlanCron: process.env["RADAR_PLAN_CRON"] ?? "0 8 1 * *",
    catchupAuto: process.env["CATCHUP_AUTO"] !== "0",
    verificador: resolveVerificador(process.env),
    radar: await loadRadarConfig(root),
    universe,
    csvPath: process.env["MANUAL_CSV"] ?? path.join(root, "config", "events.csv"),
  };
}
