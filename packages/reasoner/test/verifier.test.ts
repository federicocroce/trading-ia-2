import { describe, expect, it } from "vitest";
import type { UsageCallInput, UsageRecorder, UsageResult } from "@thesis/core";
import { createHash } from "node:crypto";
import { GeminiCandidateVerifier, GeminiToolCaller, RESEARCH_SYSTEM, UMBRAL_MAXIMO, VERIFY_TOOL, VERIFY_VERSION, VERSIONES_MISMO_INFORME, aplicarFaltantes, aplicarValuacion, buildResearchMessage, faltantesDe, parseVerification, reservaDeValuacionVale } from "../src/index.js";

function memRecorder() {
  const rows: Array<UsageCallInput & { id: string }> = [];
  const rec: UsageRecorder & { rows: typeof rows } = {
    rows,
    record(call) { const id = `id${rows.length + 1}`; rows.push({ ...call, id }); return id; },
    setResult(id, result: UsageResult) { const r = rows.find((x) => x.id === id); if (r) r.result = result; },
  };
  return rec;
}
interface Captured { model: string; body: { tools?: unknown[]; contents: Array<{ parts: Array<{ text: string }> }>; systemInstruction: { parts: Array<{ text: string }> } } }
function fakeFetch(responses: Response[]) {
  const calls: Captured[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ model: /models\/([^:]+):/.exec(String(url))?.[1] ?? "?", body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (!r) throw new Error("fakeFetch: sin más respuestas");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const grounded = (text: string) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["NVDA Q2 FY27 results", "NVDA analyst price target"], groundingChunks: [{ web: { uri: "https://redirect/1", title: "sec.gov" } }, { web: { uri: "https://redirect/2", title: "cnbc.com" } }, { retrievedContext: {} }] } }],
  usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 900, thoughtsTokenCount: 300, toolUsePromptTokenCount: 4000 },
}), { status: 200 });
const call = (args: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "candidate_verification", args } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 300, thoughtsTokenCount: 200 } }), { status: 200 });
const args = {
  verdict: "apto", reason: "Superó y subió guía; China excluida de la guía; 18,6x adelantado con crecimiento 70%.",
  lastQuarter: { reportDate: "2026-08-26", revenueVsConsensus: "96,2B vs 91,9B (+4,7%)", epsVsConsensus: "2,22 vs 2,08 no GAAP", oneOffs: ["ganancia de 7,8B por acciones (GAAP)"], guidance: "Q3 108B ±2% vs 104B esperado" },
  analysts: [{ date: "2026-08-27", firm: "UBS", action: "sube objetivo", target: 300 }, { date: "2026-09-09T00:00:00Z", firm: "Piper Sandler", action: "inicia", target: 300 }],
  consensusTarget: 328, events: [{ date: "2026-09-03", kind: "adquisicion", headline: "Compra Hugging Face por 12,9B" }], valuation: "18,6x adelantado vs 35–40x de su historia", nextEarnings: "2026-11-18",
  reservas: [], valuationNumbers: { metric: "P/E adelantado", current: 18.6, min5y: 17, max5y: 40, growthAccelerating: true },
};

describe("verificador: prompts y parseo", () => {
  /*
   * Enmienda del 13/9. NBN salió "apto" porque la verificación tomó la sorpresa del trimestre tal como venía: salía de
   * un crédito fiscal comprado y de reservas liberadas, y limpia quedaba en línea con el consenso; además cotizaba en
   * su máximo de 5 años contra el valor libro y dependía de fondeo mayorista con inmobiliario comercial al 485% del
   * capital. Y APH, NVDA y LNC tenían salvedades que yo no consideré motivo para no comprar: el criterio las nombra.
   */
  it("el cuestionario pide lo que dio vuelta a NBN, y el criterio separa lo que no es reserva", () => {
    expect(RESEARCH_SYSTEM).toContain("ganancia por acción LIMPIA");
    expect(RESEARCH_SYSTEM).toContain("historia propia de 5 años");
    expect(RESEARCH_SYSTEM).toContain("300% del capital");
    expect(RESEARCH_SYSTEM).toContain("ejercicio de opciones");
    expect(RESEARCH_SYSTEM).toContain("antimonopolio");
    expect(RESEARCH_SYSTEM).toContain("revisión anual de supuestos");
  });
  it("una reserva sin el número que la sostiene no cuenta (LNC, HIPO y DEC del 13/9)", () => {
    // La primera versión del criterio hizo que el modelo repitiera casi textual "valuación en su máximo de 5 años sin
    // aceleración" para LNC, HIPO y DEC. En LNC era falso: 0,57 veces el valor libro contra 0,83–0,87 en 2019–2021.
    // Y le atribuyó a LNC un beneficio fiscal de 0,35 que el comunicado no tiene.
    expect(RESEARCH_SYSTEM).toContain("sin esos números no es reserva");
    expect(RESEARCH_SYSTEM).toContain("nombrás el ítem, su monto y la fuente");
  });
  it("versión estable con hash; el mensaje lleva empresa, fecha y contexto", () => {
    expect(VERIFY_VERSION).toMatch(/^v1-[0-9a-f]{12}$/);
    const m = buildResearchMessage({ symbol: "NVDA", name: "NVIDIA", today: "2026-09-10", context: "banderas: consenso_compra" });
    expect(m).toContain("NVDA — NVIDIA");
    expect(m).toContain("2026-09-10");
    expect(m).toContain("consenso_compra");
    expect(VERIFY_TOOL.inputSchema).toHaveProperty("required");
  });
  it("parseVerification normaliza fechas con hora, recorta textos y rechaza dictámenes desconocidos", () => {
    const p = parseVerification(args);
    expect(p.verdict).toBe("apto");
    expect(p.analysts[1]!.date).toBe("2026-09-09");
    expect(p.lastQuarter?.reportDate).toBe("2026-08-26");
    expect(() => parseVerification({ ...args, verdict: "comprar" })).toThrow();
    expect(() => parseVerification({ ...args, extra: 1 })).toThrow();
    expect(parseVerification({ ...args, reason: `${"x".repeat(400)}` }).reason).toHaveLength(300);
  });
  it("un analista o evento sin fecha se descarta en vez de invalidar la verificación", () => {
    const p = parseVerification({ ...args, analysts: [...args.analysts, { date: null, firm: "Sin fecha", action: "mantiene", target: 10 }], events: [{ date: null, kind: "litigio", headline: "sin fecha" }, ...args.events] });
    expect(p.analysts.map((a) => a.firm)).toEqual(["UBS", "Piper Sandler"]);
    expect(p.events).toHaveLength(1);
  });
});

describe("verificador que falla cerrado (15/9)", () => {
  /*
   * El 13/9 agregué "si no encontraste el número, no uses la reserva para el dictamen" para frenar los datos
   * inventados de LNC. Terminó al revés: el 14/9 NBN salió "apto" porque la verificación "no encontró" su inmobiliario
   * comercial (485% del capital, en el mismo comunicado) ni sus ítems no recurrentes, y GFI salió "apto" sin ver que la
   * licencia de Tarkwa vence en abril de 2027. No encontrar un dato crítico no es una buena noticia.
   */
  it("el cuestionario ya no convierte un dato faltante en aprobación, y pide licencias y el comunicado de resultados", () => {
    expect(RESEARCH_SYSTEM).not.toContain("no la uses para el dictamen");
    expect(RESEARCH_SYSTEM).toContain("no encontrar un dato crítico no es una buena noticia");
    expect(RESEARCH_SYSTEM).toContain("licencias, permisos o concesiones");
    expect(RESEARCH_SYSTEM).toContain("comunicado de resultados");
    expect(RESEARCH_SYSTEM).toContain("FALTANTES:");
    // Lo que frena los datos inventados sigue: una reserva de valuación necesita sus números.
    expect(RESEARCH_SYSTEM).toContain("sin esos números no es reserva");
  });
  it("la línea FALTANTES se lee en el código: ninguno, una lista, o no está", () => {
    expect(faltantesDe("DICTAMEN: APTO — x\n...\nFALTANTES: ninguno")).toEqual([]);
    expect(faltantesDe("DICTAMEN: APTO — x\nFALTANTES: inmobiliario comercial sobre capital; ítems no recurrentes del trimestre.")).toEqual(["inmobiliario comercial sobre capital", "ítems no recurrentes del trimestre"]);
    expect(faltantesDe("DICTAMEN: APTO — x\nsin la línea")).toBeNull();
  });
  it("un apto con datos críticos faltantes pasa a con reservas; los demás dictámenes no cambian", () => {
    const apto = { verdict: "apto" as const, reason: "superó y subió la guía" };
    expect(aplicarFaltantes(apto, ["licencia de Tarkwa (vence en abril de 2027)"])).toEqual({ verdict: "con_reservas", reason: "falta verificar: licencia de Tarkwa (vence en abril de 2027)" });
    expect(aplicarFaltantes(apto, null).verdict).toBe("con_reservas");
    expect(aplicarFaltantes(apto, [])).toEqual(apto);
    expect(aplicarFaltantes({ verdict: "evitar" as const, reason: "x" }, ["y"]).verdict).toBe("evitar");
  });
  it("GFI el 14/9: el modelo dice APTO pero declara que no encontró el estado de la licencia; lo que se guarda es con reservas", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — primer semestre fuerte.\n## Informe GFI\n…\nFALTANTES: estado de la licencia de Tarkwa en Ghana"), call({ ...args, verdict: "apto", reason: "primer semestre fuerte" })]);
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: ff.fetch });
    const r = await v.verify({ symbol: "GFI", name: "Gold Fields", today: "2026-09-14" });
    expect(r.verdict).toBe("con_reservas");
    expect(r.reason).toContain("licencia de Tarkwa");
  });
  it("un informe sin la línea FALTANTES está incompleto (cortado): se rota, como el que no trae dictamen", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — x.\n1. Último trimestre… (se cortó)"), grounded("DICTAMEN: APTO — x.\n1. Último trimestre…\nFALTANTES: ninguno"), call(args)]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "NVDA", name: null, today: "2026-09-15" });
    expect(r.verdict).toBe("apto");
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok", "ok"]);
  });
});

const nums = (current: number | null, min5y: number | null, max5y: number | null, growthAccelerating: boolean | null = null) => ({ metric: "P/E adelantado", current, min5y, max5y, growthAccelerating });
const valuacion = { tipo: "valuacion" as const, detalle: "múltiplo en el tercio superior de su historia de 5 años" };
const insiders = { tipo: "insiders" as const, detalle: "venta neta de acciones por parte de insiders en los últimos 12 meses" };

describe("la reserva por valuación la decide el código (18/9)", () => {
  /*
   * Desde el cuestionario del 15/9 hubo 17 verificaciones y ninguna apta: en 15 el motivo era "la valuación está en el
   * tercio superior de su historial de 5 años". El criterio escrito dice "en su MÁXIMO de 5 años sin que el crecimiento
   * se acelere", y que una valuación premium que el crecimiento sostiene es APTO. El modelo cambió "máximo" por "tercio
   * superior" (y en NVDA y CROX ni eso era cierto con sus propios números). El plan compró cero acciones cuatro días.
   * Es la tercera vez que este criterio falla por redacción: ahora los números vienen en la tool y decide el código.
   */

  it("vale solo con los tres números, en el 10% de arriba del rango y sin crecimiento que se acelere", () => {
    expect(UMBRAL_MAXIMO).toBe(0.9);
    expect(reservaDeValuacionVale(nums(29.5, 22, 32.5))).toBe(false); // APH 15/9: 71% del rango
    expect(reservaDeValuacionVale(nums(45, 25, 70))).toBe(false); // NVDA 18/9: 44%, el tercio del medio
    expect(reservaDeValuacionVale(nums(29.5, 12, 32))).toBe(false); // SEZL 15/9: 87,5%
    expect(reservaDeValuacionVale(nums(39, 12, 40))).toBe(true); // 96% y no dice que acelere
    expect(reservaDeValuacionVale(nums(39, 12, 40, false))).toBe(true);
    expect(reservaDeValuacionVale(nums(39, 12, 40, true))).toBe(false); // premium que el crecimiento sostiene
    expect(reservaDeValuacionVale(nums(41, 12, 40))).toBe(true); // por encima de su máximo
    expect(reservaDeValuacionVale(nums(5.5, null, null))).toBe(false); // LNC 15/9: "sin esos números no es reserva"
    expect(reservaDeValuacionVale(nums(10, 12, 12))).toBe(false); // rango degenerado
    expect(reservaDeValuacionVale(null)).toBe(false);
  });
  it("APH el 15/9: la única reserva era la valuación y no está en su máximo: pasa a apto, con los números en el motivo", () => {
    const v = aplicarValuacion({ verdict: "con_reservas" as const, reason: "La valuación actual se encuentra en el tercio superior de su historial de 5 años.", reservas: [valuacion], valuationNumbers: nums(29.5, 22, 32.5) });
    expect(v.verdict).toBe("apto");
    expect(v.reason).toContain("29,5");
    expect(v.reason).toContain("22");
    expect(v.reason).toContain("32,5");
    expect(v.reason).toContain("no está en su máximo");
    expect(v.reservas).toEqual([]);
  });
  it("TSM el 15/9: valuación e insiders: sigue con reservas, y el motivo pasa a ser el que queda", () => {
    const v = aplicarValuacion({ verdict: "con_reservas" as const, reason: "La valuación está en el tercio superior de su historial de 5 años, y la venta neta de insiders sugiere cautela.", reservas: [valuacion, insiders], valuationNumbers: nums(19.73, 11, 24) });
    expect(v.verdict).toBe("con_reservas");
    expect(v.reservas).toEqual([insiders]);
    expect(v.reason).toContain("insiders");
    expect(v.reason).not.toContain("tercio superior");
  });
  it("LNC el 15/9: sin mínimo ni máximo la reserva de valuación no vale", () => {
    expect(aplicarValuacion({ verdict: "con_reservas" as const, reason: "tercio superior", reservas: [valuacion], valuationNumbers: nums(5.5, null, null) }).verdict).toBe("apto");
    expect(aplicarValuacion({ verdict: "con_reservas" as const, reason: "tercio superior", reservas: [valuacion], valuationNumbers: null }).reason).toContain("sin el múltiplo actual y su rango de 5 años");
  });
  it("una valuación en su máximo sin aceleración sigue siendo reserva, y no se toca nada", () => {
    const v = { verdict: "con_reservas" as const, reason: "39x contra un máximo de 40x", reservas: [valuacion], valuationNumbers: nums(39, 12, 40) };
    expect(aplicarValuacion(v)).toEqual(v);
  });
  it("dos reservas de valuación sobre múltiplos distintos: los números son de una sola, así que no se toca (falla cerrado)", () => {
    const otra = { tipo: "valuacion" as const, detalle: "precio sobre valor libro tangible en su máximo de 5 años" };
    const v = { verdict: "con_reservas" as const, reason: "P/E en el tercio superior y valor libro en máximo", reservas: [valuacion, otra], valuationNumbers: nums(29.5, 22, 32.5) };
    expect(aplicarValuacion(v)).toEqual(v);
  });
  it("falla cerrado: con reservas sin lista de reservas no se toca; evitar y apto tampoco", () => {
    const sinLista = { verdict: "con_reservas" as const, reason: "x", reservas: [], valuationNumbers: nums(29.5, 22, 32.5) };
    expect(aplicarValuacion(sinLista)).toEqual(sinLista);
    const evitar = { verdict: "evitar" as const, reason: "x", reservas: [valuacion], valuationNumbers: nums(29.5, 22, 32.5) };
    expect(aplicarValuacion(evitar)).toEqual(evitar);
    const apto = { verdict: "apto" as const, reason: "x", reservas: [], valuationNumbers: null };
    expect(aplicarValuacion(apto)).toEqual(apto);
  });
  it("la tool pide las reservas una por una y los números de la valuación", () => {
    const props = (VERIFY_TOOL.inputSchema as { properties: Record<string, unknown>; required: string[] });
    expect(props.required).toEqual(expect.arrayContaining(["reservas", "valuationNumbers"]));
    expect(JSON.stringify(props.properties.reservas)).toContain("valuacion");
    expect(JSON.stringify(props.properties.valuationNumbers)).toContain("max5y");
  });
  it("de punta a punta: el modelo dice CON RESERVAS por 'tercio superior' y lo que se guarda es apto; con FALTANTES vuelve a con reservas", async () => {
    const informe = (faltantes: string) => `DICTAMEN: CON RESERVAS — La valuación actual se encuentra en el tercio superior de su historial de 5 años.\n4. P/E adelantado 29,5x; mínimo 22,0x; máximo 32,5x.\nFALTANTES: ${faltantes}`;
    const estructura = { ...args, verdict: "con_reservas", reason: "La valuación actual se encuentra en el tercio superior de su historial de 5 años.", reservas: [valuacion], valuationNumbers: nums(29.5, 22, 32.5) };
    const a = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: fakeFetch([grounded(informe("ninguno")), call(estructura)]).fetch });
    expect((await a.verify({ symbol: "APH", name: "Amphenol", today: "2026-09-15" })).verdict).toBe("apto");
    const b = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: fakeFetch([grounded(informe("ítems no recurrentes del trimestre")), call(estructura)]).fetch });
    const r = await b.verify({ symbol: "APH", name: "Amphenol", today: "2026-09-15" });
    expect(r.verdict).toBe("con_reservas");
    expect(r.reason).toContain("falta verificar");
  });
});

/** sha256 de RESEARCH_SYSTEM (12 hex) al 18/9: el cuestionario con el que se hicieron los informes guardados. */
const HASH_DEL_CUESTIONARIO = "9d7715df47a9";

describe("volver a estructurar sin volver a buscar (18/9)", () => {
  /*
   * Cambiar la tool cambia la versión, y las 17 verificaciones vigentes quedarían "con cuestionario anterior": habría
   * que buscarlas de nuevo con una cuota de menos de 10 búsquedas por clave y por día. Lo que se le pregunta a la web
   * no cambió, y el informe está guardado: se re-estructura ese texto, sin búsqueda.
   */
  it("el cuestionario de investigación es el mismo que el de la versión anterior: si cambia, la lista de versiones compatibles se vacía", () => {
    const hash = createHash("sha256").update(RESEARCH_SYSTEM).digest("hex").slice(0, 12);
    // Si este hash cambia, RESEARCH_SYSTEM cambió: un informe guardado ya no responde lo que se pregunta hoy.
    // Vaciá VERSIONES_MISMO_INFORME y actualizá el hash.
    expect({ hash, versiones: VERSIONES_MISMO_INFORME }).toEqual({ hash: HASH_DEL_CUESTIONARIO, versiones: ["v1-07c33234178c-gemini"] });
  });
  it("reestructura un informe guardado con una sola llamada, sin búsqueda, y aplica las mismas reglas", async () => {
    const texto = "DICTAMEN: CON RESERVAS — tercio superior.\n4. P/E adelantado 29,5x; mínimo 22,0x; máximo 32,5x.\nFALTANTES: ninguno";
    const ff = fakeFetch([call({ ...args, verdict: "con_reservas", reason: "tercio superior", reservas: [valuacion], valuationNumbers: nums(29.5, 22, 32.5) })]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    expect(v.puedeReestructurar("v1-07c33234178c-gemini")).toBe(true);
    expect(v.puedeReestructurar("v1-07c33234178c-gemini", texto)).toBe(true);
    // Un informe guardado que está cortado no se puede re-estructurar NUNCA: quien llama tiene que buscar de nuevo, no reintentar.
    expect(v.puedeReestructurar("v1-07c33234178c-gemini", "DICTAMEN: APTO — x (se cortó)")).toBe(false);
    expect(v.puedeReestructurar("v1-c12a96012ca5-gemini")).toBe(false);
    expect(v.puedeReestructurar(v.promptVersion)).toBe(false);
    const fuentes = [{ title: "sec.gov", url: "https://redirect/1" }];
    const r = await v.reestructurar({ symbol: "APH", today: "2026-09-18", researchText: texto, sources: fuentes, model: "gemini-2.5-flash" });
    expect(r.verdict).toBe("apto");
    expect(r.researchText).toBe(texto);
    expect(r.sources).toEqual(fuentes);
    expect(r.model).toBe("gemini-2.5-flash");
    expect(ff.calls).toHaveLength(1);
    expect(ff.calls[0]!.body.tools?.some((t) => JSON.stringify(t).includes("google_search"))).toBe(false);
    expect(rec.rows.map((x) => x.purpose)).toEqual(["verificacion_estructura"]);
  });
  it("un informe guardado que está cortado no se reestructura", async () => {
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: fakeFetch([]).fetch });
    await expect(v.reestructurar({ symbol: "APH", today: "2026-09-18", researchText: "DICTAMEN: APTO — x (se cortó)", sources: [], model: null })).rejects.toThrow(/incompleto/);
  });
});

describe("que busque en vez de contestar de memoria (15/9)", () => {
  it("el pedido exige usar la búsqueda de Google, sin cambiar la versión del cuestionario", () => {
    // Después de sacar los 3.x, la falla más común de 2.5-flash era contestar sin buscar: 6 de 8 intentos a las 12:15.
    const antes = VERIFY_VERSION;
    const m = buildResearchMessage({ symbol: "PBT", name: null, today: "2026-09-15" });
    expect(m).toContain("Usá la búsqueda de Google");
    expect(m).toContain("sin búsquedas se descarta");
    // Con búsquedas concretas el modelo las hace: con la instrucción general sola buscó en 1 de cada 4 intentos (15/9).
    expect(m).toContain('"PBT earnings release 2026"');
    expect(m).toContain('"PBT guidance 2026"');
    expect(m).toContain('"PBT lawsuit OR investigation OR license 2026"');
    expect(VERIFY_VERSION).toBe(antes);
  });
});

describe("búsqueda solo en 2.5-flash (15/9)", () => {
  it("por defecto el verificador busca solo con gemini-2.5-flash: con claves gratis los 3.x no tienen búsqueda", async () => {
    const saturado = () => new Response(JSON.stringify({ error: { code: 503, message: "high demand", status: "UNAVAILABLE" } }), { status: 503 });
    const ff = fakeFetch([saturado(), saturado()]);
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], fetch: ff.fetch });
    await expect(v.verify({ symbol: "APH", name: null, today: "2026-09-15" })).rejects.toThrow();
    expect(ff.calls.map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-2.5-flash"]);
  });
});

describe("GeminiCandidateVerifier: dos llamadas (investigar con búsqueda, estructurar)", () => {
  it("investiga con google_search en el modelo de investigación, estructura con la tool, y registra ambas con su propósito", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — superó y subió guía.\n## Informe NVDA\nResultados del 26/8…\nFuentes: sec.gov, cnbc.com\nFALTANTES: ninguno"), call(args)]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["gemini-3.8-flash", "gemini-2.5-flash"], researchModels: ["gemini-2.5-flash"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "NVDA", name: "NVIDIA", today: "2026-09-10" });
    expect(ff.calls[0]!.model).toBe("gemini-2.5-flash");
    expect(ff.calls[0]!.body.tools).toEqual([{ google_search: {} }]);
    expect((ff.calls[0]!.body as unknown as { generationConfig: unknown }).generationConfig).toEqual({ maxOutputTokens: 12_000, temperature: 0.1, thinkingConfig: { thinkingBudget: 2048 } });
    expect(ff.calls[0]!.body.systemInstruction.parts[0]!.text).toContain("DICTAMEN:");
    expect(ff.calls[0]!.body.contents[0]!.parts[0]!.text).toContain("NVDA — NVIDIA");
    expect(ff.calls[1]!.model).toBe("gemini-3.8-flash");
    expect(ff.calls[1]!.body.contents[0]!.parts[0]!.text).toContain("Informe NVDA");
    expect(r.verdict).toBe("apto");
    expect(r.sources).toEqual([{ title: "sec.gov", url: "https://redirect/1" }, { title: "cnbc.com", url: "https://redirect/2" }]);
    expect(r.researchText).toContain("Resultados del 26/8");
    expect(r.model).toBe("gemini-2.5-flash");
    expect(rec.rows.map((x) => [x.purpose, x.result, x.tokensIn])).toEqual([["verificacion", "ok", 4500], ["verificacion_estructura", "ok", 1500]]);
    expect(v.promptVersion).toBe(`${VERIFY_VERSION}-gemini`);
  });
  it("estructura inválida marca la segunda llamada como validación y lanza", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — motivo.\ninforme\nFALTANTES: ninguno"), call({ ...args, verdict: "mmm" })]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    await expect(v.verify({ symbol: "X", name: null, today: "2026-09-10" })).rejects.toThrow();
    expect(rec.rows.map((x) => x.result)).toEqual(["ok", "validacion"]);
  });
  it("un informe cortado (sin la línea DICTAMEN) se descarta y rota: nunca se guarda un 'con reservas' por parseo", async () => {
    const cut = grounded("## Informe LNC\n1. Último trimestre reportado: el 30 de julio de 2026 la compañía report");
    const ff = fakeFetch([cut, grounded("DICTAMEN: APTO — 5x adelantado y 0,55x valor libro.\n1. Último trimestre…\nFALTANTES: ninguno"), call({ ...args, verdict: "apto", reason: "5x adelantado" })]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "LNC", name: "Lincoln National", today: "2026-09-11" });
    expect(r.verdict).toBe("apto");
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok", "ok"]);
  });
  it("si ningún intento trae dictamen, la verificación falla (queda pendiente, no 'con reservas')", async () => {
    const ff = fakeFetch([grounded("informe cortado"), grounded("otro informe cortado")]);
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], models: ["A"], researchModels: ["A"], fetch: ff.fetch });
    await expect(v.verify({ symbol: "LNC", name: null, today: "2026-09-11" })).rejects.toThrow(/incompleta/);
  });
  it("callGrounded sin fuentes ni búsquedas (respondió de memoria) registra validación y pasa al siguiente intento", async () => {
    const fromMemory = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "DICTAMEN: APTO — de memoria" }] }, finishReason: "STOP" }] }), { status: 200 });
    const ff = fakeFetch([fromMemory, grounded("con fuentes")]);
    const rec = memRecorder();
    const caller = new GeminiToolCaller({ keys: ["k0", "k1"], models: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(r.text).toBe("con fuentes");
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok"]);
  });
  it("callGrounded sin texto registra validación y pasa al siguiente intento", async () => {
    const empty = new Response(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }), { status: 200 });
    const ff = fakeFetch([empty, grounded("ok al segundo intento")]);
    const rec = memRecorder();
    const caller = new GeminiToolCaller({ keys: ["k0", "k1"], models: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(r.text).toBe("ok al segundo intento");
    expect(r.queries).toHaveLength(2);
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok"]);
  });
});
