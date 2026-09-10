import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import type { UsageCall } from "@thesis/core";
import { Repo, createDb, schema } from "./index.js";

const url = process.env["DATABASE_URL"];
const d = url ? describe : describe.skip;

d("Repo: registro de uso (Postgres real)", () => {
  const db = (url ? createDb(url) : null) as ReturnType<typeof createDb>;
  const repo = new Repo(db);
  const ids: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const row = (i: number, o: Partial<UsageCall> = {}): UsageCall => ({ id: ids[i]!, at: `2099-01-01T12:0${i}:00.000Z`, source: "gemini", step: "radar", purpose: "ficha", symbol: "TEST", endpoint: "gemini-2.5-flash", model: "gemini-2.5-flash", keyIndex: 1, status: 200, result: "ok", tokensIn: 100, tokensOut: 10, tokensThink: 5, ms: 321, ...o });

  afterAll(async () => {
    await db.delete(schema.externalCalls).where(inArray(schema.externalCalls.id, ids));
  });

  it("inserta por lote ignorando duplicados, lista por rango en orden, corrige el resultado y borra por retención", async () => {
    await repo.insertCalls([row(0), row(1, { source: "finnhub", purpose: null, model: null, keyIndex: null, tokensIn: null, tokensOut: null, tokensThink: null })]);
    await repo.insertCalls([row(0), row(2, { result: "rpm", status: 429 })]);
    const listed = await repo.callsBetween("2099-01-01T00:00:00.000Z", "2099-01-02T00:00:00.000Z");
    const mine = listed.filter((c) => ids.includes(c.id));
    expect(mine.map((c) => c.id)).toEqual(ids);
    expect(mine[0]).toEqual(row(0));
    expect(mine[1]!.source).toBe("finnhub");
    expect(mine[1]!.tokensIn).toBeNull();
    await repo.setCallResult(ids[0]!, "validacion");
    const again = await repo.callsBetween("2099-01-01T12:00:00.000Z", "2099-01-01T12:01:00.000Z");
    expect(again.find((c) => c.id === ids[0])!.result).toBe("validacion");
    expect(await repo.deleteCallsBefore("2099-01-01T12:01:30.000Z")).toBeGreaterThanOrEqual(2);
    const left = (await repo.callsBetween("2099-01-01T00:00:00.000Z", "2099-01-02T00:00:00.000Z")).filter((c) => ids.includes(c.id));
    expect(left.map((c) => c.id)).toEqual([ids[2]]);
  });
});
