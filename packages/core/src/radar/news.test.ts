import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analystTargets, materialHeadlines, parseAnalystAction, type NewsItem } from "../index.js";

const news = JSON.parse(readFileSync("test/fixtures/zvra-news-2026-07.json", "utf8")) as NewsItem[];
const item = (headline: string, date = "2026-08-01"): NewsItem => ({ symbol: "X", date, headline, source: "Benzinga", url: `https://x/${encodeURIComponent(headline)}`, summary: null });

describe("materialHeadlines (fixture ZVRA julio 2026)", () => {
  const m = materialHeadlines(news);
  it("marca el rechazo de la EMA como regulatorio (dos titulares del 24/7) y tres notas de analistas del 27/7", () => {
    expect(m.filter((x) => x.kind === "regulatorio").map((x) => x.item.date)).toEqual(["2026-07-24", "2026-07-24"]);
    expect(m.filter((x) => x.kind === "analista")).toHaveLength(3);
  });
  it("los resúmenes de mercado y la nota de resultados no pasan", () => {
    expect(m.some((x) => /Pre-Market Session|gapping|Q2 2026 Financial Results Call/.test(x.item.headline))).toBe(false);
  });
});

describe("materialHeadlines (patrones)", () => {
  const kind = (h: string) => materialHeadlines([item(h)])[0]?.kind ?? null;
  it("cubre los tipos del spec en inglés y español", () => {
    expect(kind("Company X receives Complete Response Letter from FDA")).toBe("regulatorio");
    expect(kind("Auditor raises substantial doubt about going concern")).toBe("continuidad");
    expect(kind("X to restate financial statements for 2025")).toBe("contable");
    expect(kind("X receives Nasdaq notice of non-compliance")).toBe("listado");
    expect(kind("X cuts full-year guidance on weak demand")).toBe("guidance");
    expect(kind("X prices $50 million public offering of common stock")).toBe("dilucion");
    expect(kind("Levi & Korsinsky notifies investors of class action against X")).toBe("litigio");
    expect(kind("X CEO steps down effective immediately")).toBe("gestion");
    expect(kind("X recorta la guía anual")).toBe("guidance");
    expect(kind("12 Health Care Stocks Moving In Friday's Session")).toBeNull();
  });
});

describe("parseAnalystAction", () => {
  it("Benzinga: mantiene con baja de objetivo", () => {
    const a = parseAnalystAction(item("BTIG Maintains Buy on Zevra Therapeutics, Lowers Price Target to $24", "2026-07-27"))!;
    expect(a).toMatchObject({ firm: "BTIG", action: "mantiene", rating: "Buy", target: 24, date: "2026-07-27" });
    expect(parseAnalystAction(item("Canaccord Genuity Maintains Buy on Zevra Therapeutics, Lowers Price Target to $20"))!.firm).toBe("Canaccord Genuity");
  });
  it("Benzinga: sube/baja de calificación e inicio de cobertura", () => {
    expect(parseAnalystAction(item("Piper Sandler Upgrades Zevra Therapeutics to Overweight, Raises Price Target to $30"))).toMatchObject({ firm: "Piper Sandler", action: "sube", rating: "Overweight", target: 30 });
    expect(parseAnalystAction(item("Goldman Sachs Downgrades Zevra Therapeutics to Neutral"))).toMatchObject({ action: "baja", rating: "Neutral", target: null });
    expect(parseAnalystAction(item("Leerink Partners Initiates Coverage On Zevra Therapeutics with Outperform Rating, Announces $28 Price Target"))).toMatchObject({ firm: "Leerink Partners", action: "inicia", rating: "Outperform", target: 28 });
  });
  it("TheFly: objetivo bajado/subido; formatos desconocidos → null", () => {
    expect(parseAnalystAction(item("Zevra Therapeutics price target lowered to $18 from $19 at Citizens JMP"))).toMatchObject({ firm: "Citizens JMP", action: "mantiene", rating: null, target: 18 });
    expect(parseAnalystAction(item("ZVRA Stock Sinks 23% On EU Setback — Analyst Says Risk Is 'A Headwind'"))).toBeNull();
  });
  it("con el fixture: tres acciones del 27/7 con objetivos 24, 24 y 20", () => {
    const acts = news.map(parseAnalystAction).filter((a) => a !== null);
    expect(acts.map((a) => [a!.firm, a!.target])).toEqual([["BTIG", 24], ["Guggenheim", 24], ["Canaccord Genuity", 20]]);
    expect(analystTargets(acts as never, "2026-09-09")).toEqual({ n: 3, median: 24, min: 20, max: 24, latestDate: "2026-07-27" });
    expect(analystTargets(acts as never, "2026-12-01")).toBeNull(); // más de 90 días
  });
});
