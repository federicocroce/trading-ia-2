import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 15/9: "la app no carga". Cada reinicio de la API dejaba la conexión de precios en vivo abierta del lado del navegador
 * (el proxy de Vite no la cerraba) y sin datos: el punto verde decía "en vivo" con precios congelados, y esas conexiones
 * muertas ocupaban los 6 lugares que Chrome da por sitio, así que las páginas quedaban esperando.
 */
class FakeES {
  static todas: FakeES[] = [];
  readonly oyentes: Record<string, (e: { data: string }) => void> = {};
  cerrada = false;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeES.todas.push(this); }
  addEventListener(tipo: string, f: (e: { data: string }) => void) { this.oyentes[tipo] = f; }
  close() { this.cerrada = true; }
  emitir(tipo: string, data: string) { this.oyentes[tipo]?.({ data }); }
}

describe("precios en vivo: una conexión muerta se detecta y se rehace", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeES.todas = [];
    vi.stubGlobal("EventSource", FakeES);
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ at: null, error: null, rows: [] }), { status: 200 })));
  });
  afterEach(() => {
    // El módulo deja el polling y el vigilante programados: se limpian antes de sacar los globales simulados.
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sin ningún mensaje (ni el ping de cada 25 s) durante un minuto, deja de decir 'en vivo' y se reconecta", async () => {
    const p = await import("./prices");
    p.startPrices();
    expect(FakeES.todas).toHaveLength(1);
    FakeES.todas[0]!.emitir("snapshot", "[]");
    expect(p.pricesLive()).toBe(true);
    // El ping mantiene viva la conexión.
    vi.advanceTimersByTime(30_000);
    FakeES.todas[0]!.emitir("ping", "1");
    vi.advanceTimersByTime(40_000);
    expect(FakeES.todas).toHaveLength(1);
    // Un minuto sin nada: la conexión está muerta aunque el navegador no lo sepa.
    vi.advanceTimersByTime(61_000);
    expect(FakeES.todas[0]!.cerrada).toBe(true);
    expect(FakeES.todas).toHaveLength(2);
    expect(p.pricesLive()).toBe(false);
    // Mientras tanto consulta por polling (y termina esa consulta antes de que el test desmonte los globales).
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetch).toHaveBeenCalled();
  });

  it("se conecta directo a la API, no a través del proxy de Vite: no ocupa los lugares de la página", async () => {
    vi.stubEnv("VITE_API_PORT", "3002");
    const p = await import("./prices");
    p.startPrices();
    expect(FakeES.todas[0]!.url).toBe("http://localhost:3002/prices/stream");
    vi.unstubAllEnvs();
  });
});
