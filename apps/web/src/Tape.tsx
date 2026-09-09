import { useMemo } from "react";
import type { PriceRow } from "./api";
import { goToSymbol } from "./SymbolLink";
import { usePrices } from "./prices";

/** Cinta del header (portada de trading v1): los que más se movieron hoy entre lo que la app sigue. En vivo desde el hub de precios. */
function Mover({ r, up }: { r: PriceRow; up: boolean }) {
  return (
    <button className={`mover ${up ? "ok" : "bad"}`} onClick={() => goToSymbol(r.symbol)} title={`${r.symbol}: ${r.changePct !== null ? `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%` : ""} hoy`}>
      <span>{up ? "▲" : "▼"}</span>
      <b>{r.symbol}</b>
      <span className="muted">${r.price.toFixed(2)}</span>
      <span>{r.changePct !== null ? `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(2)}%` : "—"}</span>
    </button>
  );
}

export function Tape() {
  const { prices, live } = usePrices();
  const { gainers, losers } = useMemo(() => {
    const fresh = [...prices.values()].filter((r) => !r.stale && r.changePct !== null);
    return {
      gainers: fresh.filter((r) => (r.changePct ?? 0) > 0).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 12),
      losers: fresh.filter((r) => (r.changePct ?? 0) < 0).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 12),
    };
  }, [prices, prices.size]);
  if (gainers.length === 0 && losers.length === 0) return null;
  return (
    <div className="tape" title={`Los que más se movieron hoy entre ${prices.size} símbolos que la app sigue (cartera, watchlist y candidatos). ${live ? "En vivo." : "Sin conexión en vivo: se actualiza cada 30 s."}`}>
      <span className={`tape-dot ${live ? "ok" : "muted"}`} title={live ? "en vivo" : "sin stream"}>●</span>
      {gainers.map((r) => <Mover key={r.symbol} r={r} up />)}
      {gainers.length > 0 && losers.length > 0 && <span className="tape-sep" />}
      {losers.map((r) => <Mover key={r.symbol} r={r} up={false} />)}
    </div>
  );
}
