import { useEffect, useState } from "react";
import { api, type Novedades as NovedadesData } from "./api";
import { SymbolLink, goToTab } from "./SymbolLink";

const STATUS_LABEL: Record<string, string> = { triggered: "🎯 gatillada: tocó el objetivo", invalidated: "❌ invalidada: tocó el stop", expired: "⏳ expirada: venció el plazo" };
const pct = (n: number | null) => (n === null ? "" : ` ${n >= 0 ? "+" : ""}${n.toFixed(1)}%`);

/** Pestaña Hoy: qué cambió contra la corrida anterior. Es lo primero que se lee a la mañana; Cartera queda solo con la cartera. */
export function Novedades() {
  const [n, setN] = useState<NovedadesData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.novedades().then(setN).catch((e) => setErr(String(e))); }, []);
  if (err) return <div className="card err">{err}</div>;
  if (!n) return <div className="card muted">Novedades…</div>;
  const Sec = ({ title, items }: { title: string; items: React.ReactNode[] }) => (items.length ? <div style={{ marginTop: 8 }}><b>{title}</b><ul className="why">{items}</ul></div> : null);
  return (
    <div className="card">
      <b>Hoy</b> <span className="muted">{n.date ? `corrida del ${n.date}${n.previousDate ? ` contra la del ${n.previousDate}` : ""}` : "sin corridas todavía"}</span>
      {n.empty && <div className="muted" style={{ marginTop: 6 }}>Nada cambió contra la corrida anterior: mismos veredictos, mismos candidatos, nada resuelto en el seguimiento, sin tesis nuevas ni noticias de lo tuyo.</div>}
      <Sec title="Piden acción hoy" items={n.alerts.map((a) => <li key={a.symbol} className="bad">⚠ <SymbolLink symbol={a.symbol} /> {a.verb}: {a.reason}</li>)} />
      <Sec title="Veredictos que cambiaron" items={n.verdictChanges.map((v) => <li key={v.symbol}><SymbolLink symbol={v.symbol} /> {v.from} → <span className={`verb ${v.to}`}>{v.to}</span> <span className="muted">{v.reason}</span></li>)} />
      <Sec title="Seguimiento resuelto en las últimas 48 horas" items={n.watchResolved.map((w) => <li key={w.symbol} className="warn"><SymbolLink symbol={w.symbol} /> {STATUS_LABEL[w.status] ?? w.status}{pct(w.returnPct)}{w.date && <span className="muted mono"> · {w.date}</span>}</li>)} />
      <Sec title="Entran a COMPRAR" items={n.enteredBuy.map((c) => <li key={c.symbol} className="ok"><SymbolLink symbol={c.symbol} /> <span className="muted" title="Score contra sus pares en desviaciones típicas, no un porcentaje. No es lo que decide COMPRAR: eso lo deciden el filtro técnico y las salvedades.">{c.kind === "etf" ? "ETF" : `score ${c.score?.toFixed(2) ?? "—"} vs pares`}</span></li>)} />
      <Sec title="Salen de COMPRAR" items={n.leftBuy.map((c) => <li key={c.symbol} className="muted"><SymbolLink symbol={c.symbol} /> ahora {c.now === "fuera" ? <span title="No se degradó: dejó de entrar en el top del ranking de hoy. No es una señal de venta.">fuera del ranking</span> : c.now}</li>)} />
      <Sec title="Tesis propuestas, esperan tu decisión" items={n.proposedTheses.slice(0, 6).map((t) => <li key={t.id}><SymbolLink symbol={t.ticker} /> {t.direction} · <span title="Edge = probabilidad estimada menos la que descuenta el mercado. Es una diferencia de probabilidades, NO un rendimiento esperado.">edge {(t.edge * 100).toFixed(0)} puntos</span>{t.pMarketFromOptions === false && <span className="warn" title="No había cadena de opciones: la probabilidad del mercado la estimó el modelo, así que el edge no se midió contra el mercado."> (mercado estimado)</span>} <span className="muted">{t.summary}</span></li>)} />
      {n.proposedTheses.length > 0 && <div style={{ marginTop: 4 }}><button className="ghost" onClick={() => goToTab("proposed")}>Ver las {n.proposedTheses.length} propuestas</button></div>}
      <Sec title="Noticias de lo tuyo (hoy y ayer)" items={n.news.map((x) => <li key={x.url}><SymbolLink symbol={x.symbol} /> <a href={x.url} target="_blank" rel="noreferrer">{x.headline}</a>{x.source && <span className="muted"> · {x.source}</span>}</li>)} />
    </div>
  );
}
