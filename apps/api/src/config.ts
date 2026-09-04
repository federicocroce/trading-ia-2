import { readFile } from "node:fs/promises";
import path from "node:path";

/** Configuración desde env + universe.json. Sin valores secretos hardcodeados. */
export interface Config {
  databaseUrl: string;
  anthropicApiKey: string | undefined;
  anthropicModel: string | undefined;
  alpaca: { keyId: string; secretKey: string; paper: true };
  userAgent: string;
  courtListenerToken: string | undefined;
  port: number;
  minEdge: number;
  maxCandidates: number;
  capitalFallbackUsd: number;
  /** Cron de la corrida diaria (hora local del proceso). */
  dailyCron: string;
  universe: Universe;
  csvPath: string;
}

export interface Universe {
  /** Tickers US a seguir en EDGAR/earnings. */
  us: string[];
  /** ADRs argentinos (allowlist del filtro). */
  adr: string[];
  /** ticker -> nombre legal para CourtListener. */
  legalNames: Record<string, string>;
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
  const universePath = process.env["UNIVERSE_PATH"] ?? path.join(root, "config", "universe.json");
  const universe = JSON.parse(await readFile(universePath, "utf8")) as Universe;
  if (process.env["ALPACA_PAPER"] === "false") throw new Error("ALPACA_PAPER=false no permitido en v1");
  return {
    databaseUrl: req("DATABASE_URL"),
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"],
    anthropicModel: process.env["ANTHROPIC_MODEL"],
    alpaca: { keyId: req("ALPACA_KEY_ID"), secretKey: req("ALPACA_SECRET_KEY"), paper: true },
    userAgent: process.env["SEC_USER_AGENT"] ?? "thesis-engine research contact@example.com",
    courtListenerToken: process.env["COURTLISTENER_TOKEN"],
    port: Number(process.env["PORT"] ?? 3001),
    minEdge: Number(process.env["MIN_EDGE"] ?? 0.1),
    maxCandidates: Number(process.env["MAX_CANDIDATES"] ?? 8),
    capitalFallbackUsd: Number(process.env["CAPITAL_USD"] ?? 100_000),
    dailyCron: process.env["DAILY_CRON"] ?? "30 7 * * 1-5",
    universe,
    csvPath: process.env["MANUAL_CSV"] ?? path.join(root, "config", "events.csv"),
  };
}
