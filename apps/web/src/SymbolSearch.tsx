import { useEffect, useRef, useState } from "react";
import { api, type SymbolHit } from "./api";

const TYPE_LABEL: Record<SymbolHit["type"], string> = { accion_us: "acción US", accion_ar: "acción AR", cedear: "CEDEAR", etf: "ETF", cripto: "cripto" };

/**
 * Buscador para agregar a la watchlist (portado del AddSymbolDialog de v1): escribís, aparecen sugerencias
 * con bandera, tipo, nombre y mercado, y agregás con un click o Enter. Si la búsqueda no responde, Enter agrega lo que escribiste.
 */
export function SymbolSearch({ existing, onAdd, placeholder = "Buscar símbolo (ej: MELI, AAPL, GGAL.BA)…", autoFocus = false }: { existing: Set<string>; onAdd: (symbol: string) => Promise<void>; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = q.trim();
    if (!s) { setHits([]); return; }
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try { const r = await api.symbols.search(s); if (alive) { setHits(r); setSel(0); } } catch { if (alive) setHits([]); } finally { if (alive) setLoading(false); }
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function add(symbol: string) {
    setBusy(symbol);
    try { await onAdd(symbol.toUpperCase()); setQ(""); setHits([]); setOpen(false); } finally { setBusy(null); }
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const h = hits[sel]; void add(h ? h.symbol : q.trim()); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div ref={box} className="symsearch">
      <input value={q} autoFocus={autoFocus} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} placeholder={placeholder} style={{ width: "100%" }} />
      {open && q.trim() && (
        <div className="symsearch-list">
          {loading && !hits.length && <div className="muted" style={{ padding: 8 }}>Buscando…</div>}
          {!loading && !hits.length && <div className="muted" style={{ padding: 8 }}>Sin resultados. Enter agrega "{q.trim().toUpperCase()}" igual.</div>}
          {hits.map((h, i) => {
            const added = existing.has(h.symbol.toUpperCase());
            return (
              <div key={h.symbol} className={`symsearch-row ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => { if (!added) void add(h.symbol); }}>
                <span>{h.flag}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 6 }}><b className="mono">{h.symbol}</b><span className="chip" style={{ fontSize: 10 }}>{TYPE_LABEL[h.type]}</span></div>
                  <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name} · {h.exchange}</div>
                </div>
                <button className={added ? "ghost" : "primary"} disabled={added || busy === h.symbol} onClick={(e) => { e.stopPropagation(); void add(h.symbol); }} style={{ fontSize: 11, padding: "2px 8px" }}>{added ? "Agregado" : busy === h.symbol ? "…" : "Agregar"}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
