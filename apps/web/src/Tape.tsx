import { useEffect, useState } from "react";
import { api, type PriceRow, type Tape as TapeData } from "./api";
import { goToSymbol } from "./SymbolLink";
import { marketRefreshMs } from "./useMarketInterval";

/** Cinta del header (portada de trading v1): los que más se movieron hoy entre lo que la app sigue. Click abre la ficha. */
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
  const [t, setT] = useState<TapeData | null>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const d = await api.prices.tape();
        if (alive) setT(d);
      } catch { /* la API no respondió: se reintenta en el próximo tick */ }
      if (alive) timer = window.setTimeout(tick, Math.max(marketRefreshMs(), 5 * 60_000));
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);
  if (!t || (t.gainers.length === 0 && t.losers.length === 0)) return null;
  return (
    <div className="tape" title={`Los que más se movieron hoy entre ${t.tracked} símbolos que la app sigue (cartera, seguimiento y candidatos). Actualizado ${new Date(t.at).toLocaleTimeString()}.`}>
      {t.gainers.map((r) => <Mover key={r.symbol} r={r} up />)}
      {t.gainers.length > 0 && t.losers.length > 0 && <span className="tape-sep" />}
      {t.losers.map((r) => <Mover key={r.symbol} r={r} up={false} />)}
    </div>
  );
}
