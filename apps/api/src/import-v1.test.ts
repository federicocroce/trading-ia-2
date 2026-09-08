import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryStore } from "@thesis/pipeline";
import { importV1, readV1 } from "./import-v1.js";

function fakeV1(): string {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "v1-")), "trading.db");
  const db = new DatabaseSync(p);
  db.exec(`create table symbols (symbol text primary key, name text, type text, flag text, plaza text, active integer, created_at text);
    create table positions (id integer primary key, symbol text, quantity real, avg_cost real, notes text, updated_at text);
    create table transactions (id integer primary key, symbol text, type text, quantity real, price real, fees real, date text, currency text, total_amount real, platform text, external_id text, notes text, created_at text);
    insert into symbols values ('YPF','YPF S.A.','adr','','argentina-energy',1,''),('TSM','TSMC','us','','global',1,'');
    insert into positions (symbol, quantity, avg_cost, notes, updated_at) values ('YPF', 557.35, 30.44, null, ''),('TSM', 26.5, 376.2, 'x', '');
    insert into transactions (symbol,type,quantity,price,fees,date,currency,total_amount,platform,external_id,notes,created_at) values ('YPF','TRANSFER',557.35,41.4,0,'2026-04-18','USD',null,'Nexo','n1',null,''),('TSM','BUY',1,300,0,'2026-05-01','USD',null,'Nexo',null,null,''),('TSM','WEIRD',1,1,0,'2026-05-02','USD',null,null,null,null,'');`);
  db.close();
  return p;
}

describe("import-v1", () => {
  it("lee posiciones con su mercado y operaciones válidas", { timeout: 30_000 }, () => {
    const { positions, transactions } = readV1(fakeV1());
    expect(positions).toEqual([
      { symbol: "TSM", quantity: 26.5, avgCost: 376.2, currency: "USD", market: "us", layer: "riesgo", notes: "x" },
      { symbol: "YPF", quantity: 557.35, avgCost: 30.44, currency: "USD", market: "adr", layer: "riesgo", notes: null },
    ]);
    expect(transactions.map((t) => t.type)).toEqual(["TRANSFER", "BUY"]);
    expect(transactions[0]!.externalId).toBe("n1");
  });
  it("importa idempotente", async () => {
    const store = new MemoryStore();
    const db = fakeV1();
    expect(await importV1(store, db)).toEqual({ positions: 2, transactions: 2 });
    expect(await importV1(store, db)).toEqual({ positions: 2, transactions: 0 });
    expect(await store.positions()).toHaveLength(2);
    expect(await store.transactions()).toHaveLength(2);
  });
});
