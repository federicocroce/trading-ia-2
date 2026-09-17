import { describe, expect, it } from "vitest";
import { fixtureHttpClient } from "../src/http/index.js";
import { EdgarIngestor, fetchFilingText, filingUrl, htmlToText } from "../src/edgar/index.js";
import { EdgarOfferForms } from "../src/edgar/ofertas.js";
import { NasdaqEarningsIngestor } from "../src/earnings/index.js";
import { AlpacaMarketData, impliedMoveFromChain, parseOcc } from "../src/alpaca/market.js";
import { AlpacaBroker } from "../src/alpaca/broker.js";
import { ArRssIngestor, extractDate } from "../src/ar/index.js";
import { ManualCsvIngestor, parseCsv } from "../src/fda/index.js";
import * as E from "./fixtures/edgar.js";
import * as N from "./fixtures/earnings.js";
import * as A from "./fixtures/alpaca.js";
import * as R from "./fixtures/ar.js";

const cfg = { keyId: "k", secretKey: "s", paper: true };

describe("EdgarIngestor", () => {
  const http = fixtureHttpClient({
    "https://www.sec.gov/files/company_tickers.json": E.companyTickers,
    "https://data.sec.gov/submissions/CIK0001234567.json": E.submissionsXXXX,
  });
  it("emite filings desde `since`, clasifica fda por keywords en título", async () => {
    const ing = new EdgarIngestor({ http, universe: ["xxxx", "NOPE"] });
    const evs = await ing.fetch("2026-08-01T00:00:00Z");
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.payload["form"])).toEqual(["8-K", "10-Q"]);
    expect(evs[0]?.eventType).toBe("operational");
    expect(evs[0]?.payload["url"]).toBe("https://www.sec.gov/Archives/edgar/data/1234567/000123456726000010/xxxx-8k.htm");
  });
  /**
   * AES, 16/9/2026. Una fusión firmada hace meses sigue fijando el precio hoy, pero la ventana de ingesta es de 30
   * días: con la regla vieja, el DEFM14A del 15/5 no entraba nunca y el Radar seguía calculándole un objetivo al
   * doble del riesgo contra un acuerdo en efectivo a 15,00.
   *
   * No cuesta un pedido más: el JSON de submissions ya viene entero, sólo se dejaba de mirar lo viejo.
   */
  it("AES: los formularios de oferta de compra entran aunque sean de hace meses; el DEF 14A anual no", async () => {
    const h = fixtureHttpClient({
      "https://www.sec.gov/files/company_tickers.json": E.companyTickersAES,
      "https://data.sec.gov/submissions/CIK0000874761.json": E.submissionsAES,
    });
    const evs = await new EdgarIngestor({ http: h, universe: ["AES"] }).fetch("2026-09-01T00:00:00Z");
    const formularios = evs.map((e) => e.payload["form"]);
    expect(formularios).toContain("DEFM14A");
    expect(formularios).toContain("PREM14A");
    // El 8-K del 16/9 entra por la ventana normal; el 10-Q de agosto y el poder anual de marzo no.
    expect(formularios).toContain("8-K");
    expect(formularios).not.toContain("10-Q");
    expect(formularios).not.toContain("DEF 14A");
  });
  it("el universo puede ser una función (posiciones + seguimiento + plan que cambian solos)", async () => {
    const ing = new EdgarIngestor({ http, universe: async () => ["XXXX"] });
    expect((await ing.fetch("2026-08-01T00:00:00Z")).length).toBe(2);
  });
  /**
   * Hasta el 13/9/2026 el vesting rutinario se salteaba sin guardarse. Ahora se guarda marcado como rutina y
   * lo descarta el filtro con su motivo: raw_events registra todo lo ingerido, y sin guardarlo la corrida
   * siguiente no podía saber que ya lo había visto y volvía a bajar su XML. Nunca llega al modelo.
   */
  it("Form 4: lee el XML, distingue compra y venta, y guarda el vesting rutinario marcado como rutina", async () => {
    const h = fixtureHttpClient({
      "https://www.sec.gov/files/company_tickers.json": E.companyTickers,
      "https://data.sec.gov/submissions/CIK0001234567.json": E.submissionsForm4,
      "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000101/wk-form4_1.xml": E.form4Purchase,
      "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000102/wk-form4_2.xml": E.form4Vesting,
      "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000103/wk-form4_3.xml": E.form4Sale,
    });
    const evs = await new EdgarIngestor({ http: h, universe: ["XXXX"] }).fetch("2026-09-01T00:00:00Z");
    expect(evs.map((e) => e.payload["insider"])).toEqual(["compra", "rutina", "venta"]);
    expect(evs[0]?.title).toBe("4 compra de insider: Marin Horacio Daniel, 352,433 acciones — Xxxx Therapeutics Inc");
    expect(evs[1]?.title).toMatch(/^4 rutina de insider/);
    expect(evs[2]?.title).toBe("4 venta de insider: Toth Peter, 3,000 acciones — Xxxx Therapeutics Inc");
    expect(evs[0]?.payload["insiderBuyShares"]).toBe(352433);
    expect(evs[2]?.payload["insiderSellShares"]).toBe(3000);
  });

  /**
   * Lo que hace posible mirar 30 días hacia atrás sin costo: una presentación ya guardada se saltea ANTES de
   * bajar su XML. El cliente de prueba falla ante cualquier URL que no tenga cargada, así que si el ingestor
   * intentara bajar el XML de las conocidas, este test rompería.
   */
  it("saltea las presentaciones que ya conoce sin bajar su XML", async () => {
    const h = fixtureHttpClient({
      "https://www.sec.gov/files/company_tickers.json": E.companyTickers,
      "https://data.sec.gov/submissions/CIK0001234567.json": E.submissionsForm4,
      // Solo el XML de la venta: las otras dos son conocidas y no se pueden pedir.
      "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000103/wk-form4_3.xml": E.form4Sale,
    });
    const conocidas = new Set(["0001234567-26-000101", "0001234567-26-000102"]);
    const pedidas: string[][] = [];
    const evs = await new EdgarIngestor({ http: h, universe: ["XXXX"], knownRefs: async (refs) => { pedidas.push(refs); return new Set(refs.filter((r) => conocidas.has(r))); } }).fetch("2026-09-01T00:00:00Z");
    expect(evs.map((e) => e.payload["insider"])).toEqual(["venta"]);
    expect(pedidas).toHaveLength(1);
  });
  it("filingUrl quita guiones y ceros del cik", () => {
    expect(filingUrl("0001234567", "0001234567-26-000010", "a.htm")).toContain("/1234567/000123456726000010/a.htm");
  });
  it("htmlToText limpia y fetchFilingText recorta", async () => {
    const t = htmlToText(E.filingHtml);
    expect(t).toContain("PDUFA target action date of November 20, 2026");
    expect(t).not.toContain("<");
    const h = fixtureHttpClient({ "https://x/f.htm": E.filingHtml });
    expect((await fetchFilingText(h, "https://x/f.htm", 20)).length).toBe(20);
  });
});

describe("NasdaqEarningsIngestor", () => {
  it("filtra por universo y fecha", async () => {
    const http = fixtureHttpClient({ "https://api.nasdaq.com/api/calendar/earnings?date=2026-09-10": N.nasdaq_2026_09_10 });
    const ing = new NasdaqEarningsIngestor({ http, universe: ["XXXX"], horizonDays: 0 });
    const evs = await ing.fetch("2026-09-10");
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ ticker: "XXXX", eventType: "earnings", eventDate: "2026-09-10" });
  });
  it("universo como función", async () => {
    const http = fixtureHttpClient({ "https://api.nasdaq.com/api/calendar/earnings?date=2026-09-10": N.nasdaq_2026_09_10 });
    expect((await new NasdaqEarningsIngestor({ http, universe: async () => ["XXXX"], horizonDays: 0 }).fetch("2026-09-10")).length).toBe(1);
  });
  it("tolera días sin respuesta", async () => {
    const ing = new NasdaqEarningsIngestor({ http: fixtureHttpClient({}), horizonDays: 2 });
    expect(await ing.fetch("2026-09-10")).toEqual([]);
  });
});

describe("AlpacaMarketData", () => {
  const http = fixtureHttpClient({
    "https://data.alpaca.markets/v2/stocks/snapshots?symbols=XXXX": A.snapshotXXXX,
    "https://data.alpaca.markets/v2/stocks/bars?symbols=XXXX": A.barsXXXX,
    "https://data.alpaca.markets/v1beta1/options/snapshots/XXXX": A.optionsXXXX,
  });
  const md = new AlpacaMarketData(http, cfg);
  it("quote con volumen promedio", async () => {
    const q = await md.getQuote("xxxx");
    expect(q?.price).toBe(10.5);
    expect(q?.avgVolume30d).toBeGreaterThan(500000);
  });
  it("parseOcc", () => {
    expect(parseOcc("XXXX260918C00010000")).toEqual({ underlying: "XXXX", expiration: "2026-09-18", type: "call", strike: 10 });
  });
  it("implied move: straddle ATM del primer vencimiento", async () => {
    const im = await md.getImpliedMove("XXXX", "2026-09-10");
    expect(im?.expiration).toBe("2026-09-18");
    expect(im?.straddle).toBeCloseTo(1.1 + 0.8);
    expect(im?.impliedMovePct).toBeCloseTo(1.9 / 10.5);
  });
  it("findOption elige el strike más cercano", async () => {
    const c = await md.findOption("XXXX", "call", "2026-09-10", 11.5);
    expect(c?.symbol).toBe("XXXX260918C00012000");
  });
  it("impliedMoveFromChain devuelve null sin par ATM", () => {
    expect(impliedMoveFromChain("X", 10, [{ symbol: "s", strike: 10, expiration: "2026-09-18", type: "call", bid: 1, ask: 1, mid: 1 }])).toBeNull();
  });
});

describe("AlpacaBroker", () => {
  it("rechaza cuenta real en v1", () => {
    const http = { ...fixtureHttpClient({}), postJson: async () => ({}), delete: async () => {} };
    expect(() => new AlpacaBroker(http as never, { ...cfg, paper: false })).toThrow(/paper/);
  });
  it("submit mapea la respuesta y traza thesisId en client_order_id", async () => {
    let sent: unknown;
    const http = {
      ...fixtureHttpClient({}),
      postJson: async (_u: string, body: unknown) => {
        sent = body;
        return { id: "o1", client_order_id: (body as { client_order_id: string }).client_order_id, symbol: "XXXX", qty: "10", filled_qty: "0", filled_avg_price: null, status: "new", submitted_at: "t", filled_at: null, limit_price: "10" };
      },
      delete: async () => {},
    };
    const b = new AlpacaBroker(http as never, cfg);
    const o = await b.submit({ thesisId: "11111111-1111-4111-8111-111111111111", ticker: "XXXX", instrument: "stock", symbol: "XXXX", side: "buy", qty: 10, limitPrice: 10, notionalUsd: 100 });
    expect(o.status).toBe("submitted");
    expect(o.brokerOrderId).toBe("o1");
    expect((sent as { client_order_id: string }).client_order_id.startsWith("11111111-1111-4111-8111-111111111111:")).toBe(true);
    expect((sent as { type: string }).type).toBe("limit");
  });
});

describe("ArRssIngestor", () => {
  it("clasifica macro vs empresa, extrae fecha y respeta since", async () => {
    const http = fixtureHttpClient({ "https://feed/ambito": R.ambitoRss });
    const ing = new ArRssIngestor({ http, feeds: [{ url: "https://feed/ambito", name: "Ámbito" }] });
    const evs = await ing.fetch("2026-09-01T00:00:00Z");
    expect(evs).toHaveLength(2);
    const macro = evs.find((e) => e.eventType === "macro_ar");
    expect(macro?.ticker).toBe("ARG");
    expect(macro?.eventDate).toBe("2026-10-15");
    const ypf = evs.find((e) => e.ticker === "YPF");
    expect(ypf?.eventType).toBe("operational");
  });
  it("extractDate pasa al año siguiente si ya pasó", () => {
    expect(extractDate("licitación del 3 de enero", "2026-09-01")).toBe("2027-01-03");
  });
});

describe("ManualCsvIngestor", () => {
  const csv = `ticker,event_type,event_date,title,ref
XXXX,fda,2026-11-20,"PDUFA para XYZ-123, indicación ABC",pdufa:xyz
YPF,legal,2026-10-01,Fallo YPF expropiación NY,cl:123
BAD,nope,2026-10-01,tipo inválido,
OLD,fda,2026-01-01,ya pasó,`;
  it("parsea, valida tipo y descarta pasados", async () => {
    const evs = await new ManualCsvIngestor({ read: async () => csv }).fetch("2026-09-04");
    expect(evs.map((e) => e.ticker)).toEqual(["XXXX", "YPF"]);
    expect(evs[0]?.title).toBe("PDUFA para XYZ-123, indicación ABC");
  });
  it("parseCsv maneja comillas", () => {
    expect(parseCsv('a,b\n"x, y",z')[0]).toEqual({ a: "x, y", b: "z" });
  });
});

/**
 * 17/9: la regla `bajoOfertaDeCompra` existía pero sólo recibía formularios del universo de ingesta (posiciones,
 * seguimiento, plan y COMPRAR del Radar). Seis empresas vendidas por contrato (AES, WTRG, ROKU, DV, BZH, BWMN) recibían
 * franja, stop y objetivo. Esta consulta mira EDGAR en vivo para cualquier símbolo, sin escribir nada.
 */
describe("EdgarOfferForms", () => {
  const fixtures = {
    "https://www.sec.gov/files/company_tickers.json": E.companyTickersAES,
    "https://data.sec.gov/submissions/CIK0000874761.json": E.submissionsAES,
  };
  it("devuelve los formularios de oferta de los últimos 400 días con el formato del ingestor; el DEF 14A anual no", async () => {
    const titulos = await new EdgarOfferForms(fixtureHttpClient(fixtures)).offerFilingTitles("aes", { today: "2026-09-17" });
    expect(titulos.some((t) => t.startsWith("DEFM14A — "))).toBe(true);
    expect(titulos.some((t) => t.startsWith("PREM14A — "))).toBe(true);
    expect(titulos.every((t) => !t.startsWith("DEF 14A"))).toBe(true);
    expect(titulos.every((t) => !t.startsWith("8-K") && !t.startsWith("10-Q"))).toBe(true);
    expect(titulos[0]).toMatch(/ — AES CORP$/);
  });
  it("fuera de la ventana no devuelve nada", async () => {
    expect(await new EdgarOfferForms(fixtureHttpClient(fixtures)).offerFilingTitles("AES", { today: "2028-01-01" })).toEqual([]);
  });
  it("símbolo sin CIK → vacío, sin error", async () => {
    expect(await new EdgarOfferForms(fixtureHttpClient(fixtures)).offerFilingTitles("NOPE", { today: "2026-09-17" })).toEqual([]);
  });
  it("cachea por símbolo dentro del proceso: dos consultas, un pedido de submissions", async () => {
    let pedidos = 0;
    const base = fixtureHttpClient(fixtures);
    const http = { ...base, getJson: async <T,>(url: string) => { if (url.includes("/submissions/")) pedidos++; return base.getJson<T>(url); } };
    const o = new EdgarOfferForms(http);
    await o.offerFilingTitles("AES", { today: "2026-09-17" });
    await o.offerFilingTitles("AES", { today: "2026-09-17" });
    expect(pedidos).toBe(1);
  });
});
