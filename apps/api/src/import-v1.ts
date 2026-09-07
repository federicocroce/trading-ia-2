import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Position, Transaction } from "@thesis/core";
import { Repo, createDb } from "@thesis/db";
import type { CarteraStore } from "@thesis/pipeline";
import { findRoot, loadConfig } from "./config.js";

/**
 * Importación única de la cartera desde trading v1 (SQLite). Idempotente: posiciones por
 * símbolo, operaciones por external_id o por (fecha, símbolo, tipo, cantidad, precio).
 * Uso: pnpm import:v1 [ruta a trading.db]
 */
const TX_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "TRANSFER"]);

interface V1Position { symbol: string; quantity: number; avg_cost: number; notes: string | null; type: string | null }
interface V1Tx { symbol: string; type: string; quantity: number; price: number; fees: number | null; date: string; currency: string | null; platform: string | null; external_id: string | null; notes: string | null }

export function readV1(dbPath: string): { positions: Position[]; transactions: Transaction[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const pos = db.prepare("select p.symbol, p.quantity, p.avg_cost, p.notes, s.type from positions p left join symbols s on s.symbol = p.symbol order by p.symbol").all() as unknown as V1Position[];
    const txs = db.prepare("select symbol, type, quantity, price, fees, date, currency, platform, external_id, notes from transactions order by date, id").all() as unknown as V1Tx[];
    return {
      positions: pos.map((p) => ({ symbol: p.symbol.toUpperCase(), quantity: p.quantity, avgCost: p.avg_cost, currency: "USD", market: p.type === "adr" ? "adr" : "us", layer: "riesgo", notes: p.notes })),
      transactions: txs
        .filter((t) => {
          const ok = TX_TYPES.has(t.type);
          if (!ok) console.warn(`[import] salteo ${t.symbol} ${t.type} ${t.date}: tipo desconocido`);
          return ok;
        })
        .map((t) => ({ id: randomUUID(), symbol: t.symbol.toUpperCase(), type: t.type as Transaction["type"], quantity: t.quantity, price: t.price, fees: t.fees ?? 0, date: t.date.slice(0, 10), currency: t.currency ?? "USD", platform: t.platform, externalId: t.external_id, notes: t.notes })),
    };
  } finally {
    db.close();
  }
}

export async function importV1(store: CarteraStore, dbPath: string): Promise<{ positions: number; transactions: number }> {
  const { positions, transactions } = readV1(dbPath);
  for (const p of positions) await store.upsertPosition(p);
  const inserted = await store.insertTransactions(transactions);
  return { positions: positions.length, transactions: inserted };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = await findRoot();
  const cfg = await loadConfig(root);
  const dbPath = process.argv[2] ?? path.join(root, "..", "trading", "data", "trading.db");
  const r = await importV1(new Repo(createDb(cfg.databaseUrl)), dbPath);
  console.log(`importadas ${r.positions} posiciones y ${r.transactions} operaciones nuevas desde ${dbPath}`);
  process.exit(0);
}
