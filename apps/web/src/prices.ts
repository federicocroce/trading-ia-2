import { useEffect, useState } from "react";
import { api, type PriceRow } from "./api";

/**
 * Precios en vivo para toda la app: una sola conexión SSE al hub de la API (foto al conectar, después solo cambios).
 * Si el stream se cae, respaldo por polling de /prices/all cada 30 s hasta que vuelva. Cartera, watchlist, cinta y ficha leen de acá.
 */
type Listener = () => void;
const rows = new Map<string, PriceRow>();
const listeners = new Set<Listener>();
let version = 0;
let at: string | null = null;
let connected = false;
let started = false;
let es: EventSource | null = null;
let pollTimer = 0;

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
function connect() {
  if (es) es.close();
  es = new EventSource("/api/prices/stream");
  es.addEventListener("snapshot", (e) => { connected = true; window.clearTimeout(pollTimer); apply(JSON.parse((e as MessageEvent).data) as PriceRow[], true); });
  es.addEventListener("prices", (e) => apply(JSON.parse((e as MessageEvent).data) as PriceRow[]));
  es.onerror = () => {
    // El navegador reintenta solo; mientras tanto, polling para no quedar en blanco.
    if (connected) { connected = false; notify(); }
    if (!pollTimer) pollTimer = window.setTimeout(poll, 1_000);
  };
}
export function startPrices() {
  if (started) return;
  started = true;
  connect();
}

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
