import { describe, expect, it } from "vitest";
import type { HttpClient } from "../src/http/index.js";
import { YahooPriceHistory, simboloYahoo } from "../src/yahoo/index.js";

/**
 * Yahoo no usa el punto de NYSE/Nasdaq para las clases, las unidades ni las preferidas: usa guion, y con otra
 * letra. Sin traducir, `MOG.A` da HTTP 404, el adaptador cae al respaldo y nadie se entera de por qué (30/9/2026,
 * mirando Moog). Son 22 símbolos de clase en el universo, BRK.B entre ellos.
 *
 * Cada equivalencia de acá se comprobó contra la API el 30/9/2026: la forma de la izquierda devuelve 404 y la de
 * la derecha 200. Los warrants (`.WS`) quedan sin tocar a propósito: ninguna de las formas probadas respondió 200,
 * así que no hay equivalencia comprobada y no se inventa.
 */
describe("simboloYahoo", () => {
  it("traduce la clase a guion, que es lo único que Yahoo acepta", () => {
    expect(simboloYahoo("MOG.A")).toBe("MOG-A");
    expect(simboloYahoo("BRK.B")).toBe("BRK-B");
    expect(simboloYahoo("LEN.B")).toBe("LEN-B");
  });

  it("deja el sufijo de plaza como está: `.BA` es de Yahoo y responde 200", () => {
    expect(simboloYahoo("GGAL.BA")).toBe("GGAL.BA");
    expect(simboloYahoo("AAPL.BA")).toBe("AAPL.BA");
  });

  it("traduce la preferida sacando la R: `.PRD` es `-PD`", () => {
    expect(simboloYahoo("ABR.PRD")).toBe("ABR-PD");
    expect(simboloYahoo("ACP.PRA")).toBe("ACP-PA");
  });

  it("traduce la unidad a `-UN`, no a `-U`", () => {
    expect(simboloYahoo("AAC.U")).toBe("AAC-UN");
  });

  it("no toca el warrant, porque no hay equivalencia comprobada", () => {
    expect(simboloYahoo("ACHR.WS")).toBe("ACHR.WS");
  });

  it("deja en paz al símbolo sin punto y normaliza a mayúsculas", () => {
    expect(simboloYahoo("AAPL")).toBe("AAPL");
    expect(simboloYahoo("mog.a")).toBe("MOG-A");
  });
});

/** Capta la URL que el adaptador pide, para probar que la traducción está enchufada y no sólo exportada. */
function httpQueCapta(urls: string[]): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      urls.push(url);
      return { chart: { result: [{ timestamp: [], indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] } }], error: null } } as T;
    },
    async getText(url: string) {
      urls.push(url);
      return "";
    },
  };
}

describe("YahooPriceHistory", () => {
  it("pide las velas con el símbolo traducido", async () => {
    const urls: string[] = [];
    await new YahooPriceHistory(httpQueCapta(urls)).candles("MOG.A", 250);
    expect(urls[0]).toContain("/chart/MOG-A?");
  });

  it("pide las velas de Buenos Aires con el punto intacto", async () => {
    const urls: string[] = [];
    await new YahooPriceHistory(httpQueCapta(urls)).candles("GGAL.BA", 250);
    expect(urls[0]).toContain("/chart/GGAL.BA?");
  });
});
