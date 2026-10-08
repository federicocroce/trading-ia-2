import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RadarPolicySchema } from "./taxonomy.js";
import { esFuentePrimaria } from "./hechos.js";

/**
 * El config REAL, no un fixture. El 16/9 `maxRows` viajaba en el JSON y el esquema lo descartaba en silencio: el
 * arreglo del corte no se notaba. Y el 17/9 el informe de /mercado midió que ocho de diez finalistas quedaban entre
 * los puestos 177 y 238: con `preselect` 150 la app nunca los evaluaba (RNR 178, HG 183, ARW 185, GL 204, ESNT 212,
 * IOSP 221, ARGX 238).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const policy = RadarPolicySchema.parse(JSON.parse(readFileSync(path.join(root, "config/radar-policy.json"), "utf8")));

describe("config/radar-policy.json (el real)", () => {
  it("preselecciona al menos 300: los finalistas del 17/9 (puestos 177 a 238) entran a la evaluación", () => {
    expect(policy.candidates.preselect).toBeGreaterThanOrEqual(300);
  });
  /*
   * 7/10: medido con `radar-cli mercado`, mismo universo y mismo día, sobre 2.551 rankeadas:
   *   preselect 300 / top 40  → 40 filas, 25 COMPRAR, score mediana 1,002
   *   preselect 900 / top 120 → 120 filas, 64 COMPRAR, score mediana 0,777
   * Ensanchar resultó ESTRICTAMENTE ADITIVO: no se perdió ninguna COMPRAR y aparecieron 39, entre ellas KLAC, RNR,
   * TEL, LLY y VRSN. Las nuevas puntúan más bajo, que es correcto: el ranking las ordena y el plan sigue eligiendo
   * desde arriba por convicción.
   *
   * Por qué `preselect` sube más que el tope: la preselección gasta pedidos de Finnhub y de EDGAR, mientras que la
   * FICHA DEL MODELO solo se escribe para las filas que quedan (`top`/`maxRows`) — y una vez por símbolo, porque
   * después persiste. Igual el tope se mueve con cuidado: cada símbolo NUEVO que entra necesita su ficha, y con la
   * cuota agotada la fila entra sin que el narrador la haya podido degradar.
   */
  /*
   * Calibración del 7/10, medida sobre la corrida REAL con estados (no con `--sin-estados`, que infla el resultado):
   *   - `preselect` 300 → 600: de 2.551 rankeadas, antes solo 300 recibían estados y evaluación completa. Costó 104
   *     pedidos de estados nuevos (el resto estaba en caché) y las COMPRAR pasaron de 54 a 58.
   *   - `maxRows` 80 → 110: **solo 6 de las 50 mejores por puntaje son COMPRAR**; las otras 52 COMPRAR están por
   *     debajo del corte, así que el mínimo para no perder ninguna comprable es 102 filas. Con 80 se perdían.
   *   - `top` se probó en 50 y se volvió a 40: las 10 filas extra por puntaje eran casi todas NO comprables, y cada
   *     fila cuesta una ficha del modelo. Con la cuota agotada la fila entra sin que el narrador pueda degradarla.
   * El costo se vio en la corrida: 62 de 110 filas quedaron sin ficha porque se agotó la cuota de Gemini. El refresco
   * las completa cuando la cuota vuelve (el 4/10 pasó lo mismo: 46 sin ficha, y al día siguiente quedó 1).
   */
  it("preselecciona 600, corta 40 por puntaje y deja hasta 110 filas: medido el 7/10 contra la corrida real", () => {
    expect(policy.candidates.preselect).toBe(600);
    expect(policy.candidates.top).toBe(40);
    expect(policy.candidates.maxRows).toBe(110);
  });
});

const leer = (f: string) => JSON.parse(readFileSync(path.join(root, "config", f), "utf8"));

describe("config/etfs.json y config/taxonomia.json (los reales)", () => {
  /*
   * 6/10/2026. ILF es el iShares Latin America 40 y estaba etiquetado tema "argentina". Su ficha oficial al
   * 31/3/2026: Brasil 59,10%, México 25,28%, Chile 6,79%, Perú 5,79%, Colombia 2,36%. Argentina: cero.
   * Con la cartera marcando "tema argentina 73,07%", si ILF entrara sumaría 100% a esa concentración y el
   * aviso diría algo falso. ARGT sí es Argentina y se queda como está.
   */
  it("ILF no cuenta como tema argentina: su índice no tiene Argentina", () => {
    const ilf = (leer("etfs.json") as Array<{ symbol: string; themes?: string[] }>).find((e) => e.symbol === "ILF");
    expect(ilf).toBeDefined();
    expect(ilf!.themes ?? []).not.toContain("argentina");
    expect(leer("taxonomia.json").symbolToThemes?.ILF ?? []).not.toContain("argentina");
  });
  it("ARGT sigue siendo Argentina: es el único ETF del panel que la replica", () => {
    const argt = (leer("etfs.json") as Array<{ symbol: string; themes?: string[] }>).find((e) => e.symbol === "ARGT");
    expect(argt!.themes ?? []).toContain("argentina");
  });
});

describe("config/hechos-fuentes.json (el real)", () => {
  /*
   * 6/10/2026. `hostsPrimarios` tenía 14 hosts y ninguno argentino, y este módulo dice en su encabezado que
   * "sólo lo VERIFICADO mueve algo. Verificado = la fuente es primaria". Con la cartera 73% argentina eso
   * significaba que ningún hecho de la CNV, el Boletín Oficial, el BCRA o el INDEC podía mover una decisión:
   * de 128 hechos cargados, 1 era argentino. La CNV es el equivalente argentino de la SEC.
   *
   * Los seis casos de las últimas seis semanas que esto se perdía: el cambio de control de METR.BA por USD 780 M
   * y su prórroga de licencia a 2047, los cuatro hechos relevantes de MOLI.BA, la OPA de ARS 70 de BOLT.BA, la
   * obligación de TEO de ceder 6 M de clientes, la pérdida de ARS 18.437 M de LEDE.BA y la caída del 62,6% de AGRO.BA.
   */
  const hosts = leer("hechos-fuentes.json").hostsPrimarios as string[];
  it("la CNV vale como fuente primaria, igual que la SEC", () => {
    expect(esFuentePrimaria("https://aif2.cnv.gov.ar/presentations/publicview/9e2e405b", hosts)).toBe(true);
    expect(esFuentePrimaria("https://www.cnv.gov.ar/SitioWeb/Empresas/Empresa/30500858628", hosts)).toBe(true);
  });
  it("el Boletín Oficial, el BCRA y el INDEC también", () => {
    expect(esFuentePrimaria("https://www.boletinoficial.gob.ar/detalleAviso/primera/341475", hosts)).toBe(true);
    expect(esFuentePrimaria("https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informe-bancos.pdf", hosts)).toBe(true);
    expect(esFuentePrimaria("https://www.indec.gob.ar/uploads/informesdeprensa/emae_09_26.pdf", hosts)).toBe(true);
  });
  it("la SEC sigue valiendo y un portal sigue sin valer", () => {
    expect(esFuentePrimaria("https://www.sec.gov/Archives/edgar/data/904851/x.htm", hosts)).toBe(true);
    expect(esFuentePrimaria("https://www.infobae.com/economia/2026/10/03/nota/", hosts)).toBe(false);
  });
});
