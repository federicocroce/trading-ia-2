import { useState } from "react";
import { api, type WatchItem, type WatchStatus } from "./api";

const STATUS: Record<WatchStatus, { icon: string; label: string; cls: string; help: string }> = {
  live: { icon: "🟢", label: "VIVA", cls: "ok", help: "En seguimiento: no tocó stop ni objetivo y no venció el plazo." },
  triggered: { icon: "🎯", label: "GATILLADA", cls: "ok", help: "Tocó el objetivo que tenía al agregarla. Revisala: tomar ganancia o sacarla de la lista." },
  invalidated: { icon: "❌", label: "INVALIDADA", cls: "bad", help: "Tocó el stop que tenía al agregarla. La tesis se anuló: sacala de la lista o volvé a evaluarla." },
  expired: { icon: "⏳", label: "EXPIRADA", cls: "muted", help: "Venció el plazo (30 días) sin tocar stop ni objetivo." },
};
export const isResolved = (s: WatchStatus) => s !== "live";

/** Badge compacto con el estado del ciclo de vida y el retorno desde el alta (portado de v1). */
export function WatchStatusBadge({ item, showReturn = true }: { item: WatchItem; showReturn?: boolean }) {
  const m = STATUS[item.status];
  const ret = item.status === "live" ? item.lastReturn : item.resolutionReturn;
  const title = `${m.help} Alta ${item.addedAt.slice(0, 10)}${item.entryPrice ? ` a $${item.entryPrice.toFixed(2)}` : ""}${item.entryAction && item.entryAction !== "manual" ? ` (${item.entryAction})` : ""}${item.thesis ? `. ${item.thesis}` : ""}`;
  return (
    <span className={`wbadge ${m.cls}`} title={title}>
      <span>{m.icon}</span><span>{m.label}</span>
      {showReturn && ret !== null && ret !== undefined && <span className="mono">{ret >= 0 ? "+" : ""}{ret.toFixed(1)}%</span>}
    </span>
  );
}

/** "+ Watchlist" si no está en la lista; si ya está, el badge de estado. */
export function WatchlistButton({ symbol, items, onChanged }: { symbol: string; items: WatchItem[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const item = items.find((i) => i.symbol === symbol.toUpperCase());
  if (item) return <WatchStatusBadge item={item} />;
  return (
    <button className="ghost" style={{ fontSize: 11, padding: "2px 8px" }} disabled={busy} onClick={async (e) => { e.stopPropagation(); setBusy(true); try { await api.radar.addWatch(symbol); onChanged(); } finally { setBusy(false); } }}>
      {busy ? "…" : "+ Watchlist"}
    </button>
  );
}
