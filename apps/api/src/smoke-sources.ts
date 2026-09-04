/**
 * Smoke de fuentes públicas en vivo (sin DB, sin LLM, sin Alpaca).
 * Uso: pnpm smoke:sources
 */
import { ArRssIngestor, EdgarIngestor, NasdaqEarningsIngestor, createHttpClient } from "@thesis/adapters";
import { loadConfig } from "./config.js";

const cfg = await loadConfig().catch(() => null);
const http = createHttpClient({ userAgent: cfg?.userAgent ?? process.env["SEC_USER_AGENT"] ?? "thesis-engine smoke contact@example.com" });
const universe = cfg ? [...cfg.universe.us, ...cfg.universe.adr] : ["YPF", "TSM"];
const since = new Date(Date.now() - 20 * 86_400_000).toISOString();

const sources = [
  ["edgar", new EdgarIngestor({ http, universe })],
  ["nasdaq earnings", new NasdaqEarningsIngestor({ http, universe, horizonDays: 45 })],
  ["ar rss", new ArRssIngestor({ http })],
] as const;

for (const [name, ing] of sources) {
  try {
    const evs = await ing.fetch(since);
    console.log(`✓ ${name}: ${evs.length} eventos`);
    for (const e of evs.slice(0, 3)) console.log(`    ${e.ticker.padEnd(5)} ${e.eventType.padEnd(11)} ${e.eventDate ?? "-"}  ${e.title.slice(0, 70)}`);
  } catch (e) {
    console.log(`✗ ${name}: ${String(e).slice(0, 160)}`);
  }
}
