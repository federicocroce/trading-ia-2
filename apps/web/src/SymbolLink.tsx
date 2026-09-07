/** Un ticker clickeable en cualquier tabla: abre la página global del símbolo (?symbol=XXX). */
export function goToSymbol(symbol: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("symbol", symbol.toUpperCase());
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function SymbolLink({ symbol, children }: { symbol: string; children?: React.ReactNode }) {
  return (
    <a href={`?symbol=${symbol}`} className="symlink" onClick={(e) => { e.preventDefault(); goToSymbol(symbol); }}>
      {children ?? <b>{symbol}</b>}
    </a>
  );
}
