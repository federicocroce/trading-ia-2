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

/** Ir a una pestaña (y sub-pestaña) sin recargar: misma mecánica que goToSymbol. */
export function goToTab(tab: string, sub?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  url.searchParams.delete("symbol");
  if (sub) url.searchParams.set("sub", sub); else url.searchParams.delete("sub");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
