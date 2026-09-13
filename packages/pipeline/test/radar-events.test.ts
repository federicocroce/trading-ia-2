import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClassifiedEvent, EventClassifier, EventClassifierInput, NewsItem } from "@thesis/core";
import { MemoryStore, scanEventsFor } from "../src/index.js";

const fixture = (JSON.parse(readFileSync("test/fixtures/zvra-news-2026-07.json", "utf8")) as NewsItem[]);
const T = "2026-09-09";
// Un evento por cada ítem recibido (con su id), ruido incluido: lo que el ruling final exige de cualquier clasificador.
const graveIf = (re: RegExp): EventClassifier => ({
  promptVersion: "e-test",
  classify: async (i: EventClassifierInput): Promise<ClassifiedEvent[]> => i.items.map((x) => ({ date: x.date, kind: x.kind, severity: re.test(x.headline) ? "grave" : "ruido", headline: x.headline, url: x.url, source: x.source, why: "test" })),
});
const failing: EventClassifier = { promptVersion: "e-test", classify: async () => { throw new Error("cuota"); } };

describe("scanEventsFor", () => {
  it("ventana completa: guarda noticias, analistas y eventos; devuelve el grave y los objetivos; avanza el barrido", async () => {
    const store = new MemoryStore();
    const calls: string[][] = [];
    const news = { companyNews: async (s: string, from: string, to: string) => { calls.push([s, from, to]); return fixture; } };
    const r = await scanEventsFor({ store, news, classifier: graveIf(/Negative Opinion From EMA CHMP/) }, "ZVRA", { today: T, name: "Zevra", full: true });
    expect(calls[0]).toEqual(["ZVRA", "2026-06-11", T]);
    expect(r.unclassified).toBe(false);
    expect(r.events).toEqual([{ date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: expect.stringContaining("Negative Opinion From EMA CHMP") }]);
    expect(r.analystTargets).toEqual({ n: 3, median: 24, min: 20, max: 24, latestDate: "2026-07-27" });
    expect((await store.news("ZVRA", 50)).length).toBe(16);
    expect((await store.eventsFor("ZVRA", "2026-06-11")).map((e) => e.severity).sort()).toEqual(["grave", "ruido"]); // el otro titular regulatorio quedó como ruido
    expect(await store.newsScannedTo("ZVRA")).toBe(T);
  });
  it("incremental: pide desde el último barrido y no reclasifica lo conocido", async () => {
    const store = new MemoryStore();
    const classified: number[] = [];
    const classifier: EventClassifier = { promptVersion: "e", classify: async (i) => { classified.push(i.items.length); return graveIf(/EMA CHMP/).classify(i); } };
    const news = { companyNews: async (_s: string, from: string) => fixture.filter((n) => n.date >= from) };
    await scanEventsFor({ store, news, classifier }, "ZVRA", { today: "2026-07-25", name: null, full: true });
    const r = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null });
    expect(classified).toEqual([2]); // la segunda vez no hay titulares nuevos para el modelo
    expect(r.events).toHaveLength(1);
  });
  it("un cambio de prefiltro alcanza a lo ya guardado: el titular del DOJ del 10/9 se clasifica en el próximo barrido", async () => {
    // NVDA ya estaba barrida hasta el 12/9 cuando el prefiltro aprendió a reconocer antimonopolio. Como el barrido es
    // incremental, sin esto los titulares del 10/9 no se volvían a mirar nunca.
    const store = new MemoryStore();
    const doj: NewsItem = { symbol: "NVDA", date: "2026-09-10", headline: "Nvidia Stock Falls. DOJ Probes $20 Billion Groq Deal", source: "Barron's", url: "https://n/doj", summary: null };
    await store.upsertNews([doj]);
    await store.setNewsScannedTo("NVDA", "2026-09-12");
    const recibidos: string[] = [];
    const classifier: EventClassifier = { promptVersion: "e", classify: async (i) => { recibidos.push(...i.items.map((x) => x.headline)); return i.items.map((x) => ({ date: x.date, kind: x.kind, severity: "moderado", headline: x.headline, url: x.url, source: x.source, why: "DOJ" })); } };
    const r = await scanEventsFor({ store, news: { companyNews: async () => [] as NewsItem[] }, classifier }, "NVDA", { today: "2026-09-13", name: "NVIDIA" });
    expect(recibidos).toEqual([doj.headline]);
    expect(r.events).toEqual([{ date: "2026-09-10", kind: "regulatorio", severity: "moderado", headline: doj.headline }]);
  });
  it("clasificador caído → unclassified, sin avanzar el barrido; sin clasificador → igual", async () => {
    const store = new MemoryStore();
    const news = { companyNews: async () => fixture };
    const r = await scanEventsFor({ store, news, classifier: failing }, "ZVRA", { today: T, name: null, full: true });
    expect(r.unclassified).toBe(true);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    expect((await scanEventsFor({ store, news, classifier: null }, "ZVRA", { today: T, name: null, full: true })).unclassified).toBe(true);
  });
  it("noticias caídas → no avanza el barrido pero devuelve lo guardado", async () => {
    const store = new MemoryStore();
    await store.upsertEvents([{ symbol: "ZVRA", date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: "EMA", url: "https://n/1", source: null, why: null, detectedAt: "2026-09-01T00:00:00Z", promptVersion: null }]);
    const r = await scanEventsFor({ store, news: { companyNews: async () => { throw new Error("finnhub"); } }, classifier: null }, "ZVRA", { today: T, name: null });
    expect(r.events).toHaveLength(1);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
  });
  it("más de 15 titulares nuevos: el tope no los descarta, quedan postergados y se completan en el próximo barrido", async () => {
    const store = new MemoryStore();
    const items: NewsItem[] = Array.from({ length: 35 }, (_, i) => ({ symbol: "ZVRA", date: "2026-07-24", headline: `Zevra Receives Complete Response Letter ${i}`, source: "Benzinga", url: `https://n/crl-${i}`, summary: null }));
    const classified: number[] = [];
    const classifier: EventClassifier = {
      promptVersion: "e-test",
      classify: async (i: EventClassifierInput): Promise<ClassifiedEvent[]> => { classified.push(i.items.length); return i.items.map((x) => ({ date: x.date, kind: x.kind, severity: "ruido", headline: x.headline, url: x.url, source: x.source, why: "test" })); },
    };
    const news = { companyNews: async () => items };
    const r1 = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null, full: true });
    expect(classified).toEqual([15]);
    expect(r1.unclassified).toBe(true);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    const r2 = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null, full: true });
    expect(classified).toEqual([15, 15]);
    expect(r2.unclassified).toBe(true);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    const r3 = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null, full: true });
    expect(classified).toEqual([15, 15, 5]); // los 5 que quedaron afuera de las dos primeras
    expect(r3.unclassified).toBe(false);
    expect(await store.newsScannedTo("ZVRA")).toBe(T);
  });
  it("ids omitidos por el clasificador: no se persisten, unclassified queda true y el próximo barrido los reintenta", async () => {
    const store = new MemoryStore();
    const items: NewsItem[] = Array.from({ length: 3 }, (_, i) => ({ symbol: "ZVRA", date: "2026-07-24", headline: `Zevra Receives Complete Response Letter ${i}`, source: "Benzinga", url: `https://n/omit-${i}`, summary: null }));
    let call = 0;
    const classifier: EventClassifier = {
      promptVersion: "e-test",
      classify: async (i: EventClassifierInput): Promise<ClassifiedEvent[]> => {
        call++;
        // primera vez: omite el id 1 (no devuelve un evento para ese ítem); segunda vez: lo devuelve.
        const toReturn = call === 1 ? i.items.filter((x) => x.id !== 1) : i.items;
        return toReturn.map((x) => ({ date: x.date, kind: x.kind, severity: "ruido", headline: x.headline, url: x.url, source: x.source, why: "test" }));
      },
    };
    const news = { companyNews: async () => items };
    const r1 = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null, full: true });
    expect(r1.unclassified).toBe(true);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    expect((await store.eventsFor("ZVRA", "2026-06-11")).map((e) => e.url).sort()).toEqual(["https://n/omit-0", "https://n/omit-2"]); // el id 1 no se persistió
    const r2 = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null, full: true });
    expect(r2.unclassified).toBe(false);
    expect(await store.newsScannedTo("ZVRA")).toBe(T);
    expect((await store.eventsFor("ZVRA", "2026-06-11")).map((e) => e.url).sort()).toEqual(["https://n/omit-0", "https://n/omit-1", "https://n/omit-2"]);
  });
  it("parseAnalystAction corre sobre TODOS los ítems fetched: un titular que el prefiltro clasifica regulatorio primero igual genera la acción de analista", async () => {
    const store = new MemoryStore();
    const headline = "BTIG Maintains Buy on Zevra after CHMP negative opinion, Lowers Price Target to $24";
    const items: NewsItem[] = [{ symbol: "ZVRA", date: "2026-07-27", headline, source: "Benzinga", url: "https://n/btig-chmp", summary: null }];
    const news = { companyNews: async () => items };
    await scanEventsFor({ store, news, classifier: null }, "ZVRA", { today: T, name: null, full: true });
    const actions = await store.analystActions("ZVRA", "2026-06-11");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ firm: "BTIG", action: "mantiene", rating: "Buy", target: 24 });
  });
});
