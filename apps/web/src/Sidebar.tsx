import { useEffect, useMemo, useState } from "react";
import { api, type PriceRow, type Tags, type Watchlist } from "./api";
import { goToSymbol } from "./SymbolLink";
import { WatchStatusBadge, isResolved } from "./WatchlistButton";
import { marketRefreshMs } from "./useMarketInterval";

/** Watchlist en barra lateral (portada de trading v1): precios vivos, búsqueda, filtro por tipo, orden, ciclo de vida, alta y baja. */
type SortMode = "default" | "changeDesc" | "changeAsc" | "category";
const SORT_LABEL: Record<SortMode, string> = { default: "Orden de alta", changeDesc: "Mayor suba", changeAsc: "Mayor baja", category: "Por tipo" };
type TypeFilter = "all" | Tags["assetClass"];
const TYPE_LABEL: Record<string, string> = { all: "Todos", accion_us: "Acciones US", adr: "ADRs", accion_ar: "Acciones AR", cedear: "CEDEARs", etf: "ETFs", cripto: "Cripto", bono: "Bonos", commodity: "Commodities", efectivo: "Efectivo" };
const FLAG: Record<string, string> = { accion_us: "🇺🇸", adr: "🌎", accion_ar: "🇦🇷", cedear: "🇦🇷", etf: "📦", cripto: "₿", bono: "📄", commodity: "🛢", efectivo: "💵" };
const readSort = (): SortMode => { try { const v = localStorage.getItem("watchlist:sort"); return v === "changeDesc" || v === "changeAsc" || v === "category" ? v : "default"; } catch { return "default"; } };

export function Sidebar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [w, setW] = useState<Watchlist | null>(null);
  const [prices, setPrices] = useState<Map<string, PriceRow>>(new Map());
  const [q, setQ] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortMode>(readSort);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => { try { setW(await api.radar.watchlist()); } catch (e) { setErr(String(e)); } };
  useEffect(() => { void load(); const onPop = () => void load(); window.addEventListener("watchlist:changed", onPop); return () => window.removeEventListener("watchlist:changed", onPop); }, []);
  const symbols = useMemo(() => (w?.items ?? []).map((i) => i.symbol), [w]);
  useEffect(() => {
    if (!symbols.length) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try { const rows = await api.prices.get(symbols); if (alive) setPrices(new Map(rows.map((r) => [r.symbol, r]))); } catch { /* reintenta */ }
      if (alive) timer = window.setTimeout(tick, marketRefreshMs());
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [symbols.join(",")]);
  useEffect(() => { try { localStorage.setItem("watchlist:sort", sort); } catch { /* sin almacenamiento */ } }, [sort]);

  const rowFor = useMemo(() => new Map((w?.rows ?? []).map((r) => [r.symbol, r])), [w]);
  const list = useMemo(() => {
    const items = (w?.items ?? []).filter((i) => {
      const tags = rowFor.get(i.symbol)?.tags ?? null;
      if (type !== "all" && tags?.assetClass !== type) return false;
      const s = q.trim().toLowerCase();
      return !s || i.symbol.toLowerCase().includes(s) || (i.note ?? "").toLowerCase().includes(s) || (i.thesis ?? "").toLowerCase().includes(s);
    });
    if (sort === "changeDesc" || sort === "changeAsc") {
      const dir = sort === "changeDesc" ? -1 : 1;
      return [...items].sort((a, b) => { const pa = prices.get(a.symbol)?.changePct, pb = prices.get(b.symbol)?.changePct; if (pa == null && pb == null) return 0; if (pa == null) return 1; if (pb == null) return -1; return (pa - pb) * dir; });
    }
    if (sort === "category") return [...items].sort((a, b) => (rowFor.get(a.symbol)?.tags?.assetClass ?? "zz").localeCompare(rowFor.get(b.symbol)?.tags?.assetClass ?? "zz") || a.symbol.localeCompare(b.symbol));
    return items;
  }, [w, rowFor, q, type, sort, prices]);

  async function add() {
    const s = adding.trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    setErr(null);
    try { setW(await api.radar.addWatch(s)); setAdding(""); window.dispatchEvent(new Event("watchlist:changed")); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }
  async function remove(s: string) {
    setW(await api.radar.removeWatch(s));
    window.dispatchEvent(new Event("watchlist:changed"));
  }
  const needsReview = (w?.items ?? []).filter((i) => isResolved(i.status)).length;

  if (!open) return <button className="sidebar-toggle" onClick={onToggle} title="Abrir watchlist">☰ Watchlist{needsReview > 0 && <span className="warn"> · {needsReview} para revisar</span>}</button>;
  return (
    <aside className="sidebar">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>WATCHLIST {w ? `(${w.items.length})` : ""}</b>
        <button className="ghost" style={{ padding: "0 6px" }} onClick={onToggle} title="Ocultar">×</button>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="Agregar (VST, GGAL.BA…)" style={{ flex: 1, minWidth: 0 }} />
        <button className="primary" disabled={busy || !adding.trim()} onClick={() => void add()}>+</button>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por símbolo, nota o tesis" style={{ marginTop: 6, width: "100%" }} />
      <div className="row" style={{ marginTop: 6 }}>
        <select value={type} onChange={(e) => setType(e.target.value as TypeFilter)} style={{ flex: 1 }}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)} style={{ flex: 1 }}>{(Object.keys(SORT_LABEL) as SortMode[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}</select>
      </div>
      {err && <div className="err">{err}</div>}
      {needsReview > 0 && <div className="warn" style={{ marginTop: 6, fontSize: 12 }}>{needsReview} para revisar: tocaron stop u objetivo, o vencieron.</div>}
      <div className="sidebar-list">
        {list.map((i) => {
          const p = prices.get(i.symbol);
          const r = rowFor.get(i.symbol);
          const review = isResolved(i.status);
          const cls = p ? (p.stale ? "muted" : (p.changePct ?? 0) >= 0 ? "ok" : "bad") : "muted";
          return (
            <div key={i.symbol} className={`sidebar-row ${review ? "review" : ""}`} onClick={() => goToSymbol(i.symbol)}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><span>{FLAG[r?.tags?.assetClass ?? ""] ?? "🌐"}</span><b>{i.symbol}</b>{r && <span className={`verb ${r.verdict}`} style={{ fontSize: 10, padding: "0 6px" }}>{r.verdict}</span>}</div>
                <div style={{ marginTop: 2 }}><WatchStatusBadge item={i} /></div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {p ? (
                  <div style={{ textAlign: "right" }}>
                    <div className="mono">{p.stale && <span className="warn" title={`Sin operaciones recientes: último precio ${p.asOf?.slice(0, 10) ?? "?"}. No es el precio de hoy.`}>⚠ </span>}{p.currency === "ARS" ? "$" : "$"}{p.price.toFixed(2)}</div>
                    <div className={`mono ${cls}`} style={{ fontSize: 12 }}>{p.changePct !== null ? `${p.changePct >= 0 ? "+" : ""}${p.changePct.toFixed(2)}%` : "—"}</div>
                  </div>
                ) : <span className="muted">…</span>}
                <button className={`ghost sidebar-x ${review ? "always" : ""}`} title="Sacar de la watchlist" onClick={(e) => { e.stopPropagation(); void remove(i.symbol); }}>×</button>
              </div>
            </div>
          );
        })}
        {w && !list.length && <div className="muted" style={{ padding: 8, fontSize: 12 }}>Nada que mostrar. Agregá un ticker arriba.</div>}
      </div>
    </aside>
  );
}
