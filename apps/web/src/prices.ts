import { useEffect, useState } from "react";
import { api, type PriceRow } from "./api";

/**
 * Precios en vivo para toda la app: una sola conexión SSE al hub de la API (foto al conectar, después solo cambios).
 * Si el stream se cae, respaldo por polling de /prices/all cada 30 s hasta que vuelva. Cartera, watchlist, cinta y ficha leen de acá.
 *
 * 15/9 ("la app no carga"): la conexión iba por el proxy de Vite, y cada reinicio de la API la dejaba abierta del lado
 * del navegador y sin datos. El punto verde decía "en vivo" con precios congelados, y esas conexiones muertas ocupaban
 * los 6 lugares que Chrome da por sitio: las páginas quedaban esperando. Ahora va directo a la API (otro sitio para
 * Chrome, no le quita lugar a la página) y un vigilante la rehace si pasa un minuto sin ningún mensaje: el hub manda un
 * ping cada 25 s, así que un minuto en silencio es una conexión muerta.
 */
/** Sin ningún mensaje durante este tiempo, la conexión está muerta aunque el navegador no lo sepa. */
const SILENCIO_MAX_MS = 60_000;
// Con punto a propósito: Vite lo reemplaza por el puerto al servir el código (`define` en vite.config.ts); con corchetes no.
const puertoApi: string | undefined = import.meta.env.VITE_API_PORT;
const streamUrl = () => (puertoApi ? `${location.protocol}//${location.hostname}:${puertoApi}/prices/stream` : "/api/prices/stream");
type Listener = () => void;
const rows = new Map<string, PriceRow>();
const listeners = new Set<Listener>();
let version = 0;
let at: string | null = null;
let connected = false;
let started = false;
let es: EventSource | null = null;
let pollTimer = 0;
let vigilante = 0;
let ultimoMensaje = 0;

function notify() {
  version++;
  for (const l of listeners) l();
}
function apply(list: PriceRow[], replace = false) {
  if (replace) rows.clear();
  for (const r of list) rows.set(r.symbol.toUpperCase(), r);
  at = new Date().toISOString();
  notify();
}
async function poll() {
  try {
    const d = await api.prices.all();
    apply(d.rows, true);
  } catch { /* la API no respondió: el próximo poll reintenta */ }
  pollTimer = window.setTimeout(poll, 30_000);
}
/** Pasa a polling mientras no haya stream: lo que se ve no puede decir "en vivo" sin datos. */
function sinStream() {
  if (connected) { connected = false; notify(); }
  if (!pollTimer) pollTimer = window.setTimeout(poll, 1_000);
}
function vigilar() {
  window.clearTimeout(vigilante);
  vigilante = window.setTimeout(() => {
    if (Date.now() - ultimoMensaje < SILENCIO_MAX_MS) return vigilar();
    // Un minuto sin nada, ni siquiera el ping: se cierra y se rehace.
    sinStream();
    connect();
  }, SILENCIO_MAX_MS + 1_000);
}
function connect() {
  if (es) es.close();
  es = new EventSource(streamUrl());
  ultimoMensaje = Date.now();
  const vivo = () => { ultimoMensaje = Date.now(); };
  es.addEventListener("snapshot", (e) => { vivo(); connected = true; window.clearTimeout(pollTimer); pollTimer = 0; apply(JSON.parse((e as MessageEvent).data) as PriceRow[], true); });
  es.addEventListener("prices", (e) => { vivo(); apply(JSON.parse((e as MessageEvent).data) as PriceRow[]); });
  es.addEventListener("ping", vivo);
  // El navegador reintenta solo; mientras tanto, polling para no quedar en blanco.
  es.onerror = sinStream;
  vigilar();
}
export function startPrices() {
  if (started) return;
  started = true;
  connect();
}

/** Si el stream está vivo (para quien no usa el hook). */
export const pricesLive = () => connected;

/** Mapa símbolo → último precio, y si el stream está vivo. Re-renderiza cuando llega algo. */
export function usePrices(): { prices: Map<string, PriceRow>; live: boolean; at: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    startPrices();
    const l = () => force((v) => v + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  void version;
  return { prices: rows, live: connected, at };
}
