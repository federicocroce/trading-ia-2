import type { EntryTiming } from "./api";

/**
 * Cuándo entrar. El Radar decía QUÉ comprar y a qué precio máximo, pero no si hoy era el día:
 * entrar en una acción buena justo cuando está 3 ATR arriba de su media es comprar el envión.
 * Acá se muestra el estado, el precio y hasta cuándo vale la condición.
 */
const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

export const entryIsNow = (e: EntryTiming | null | undefined): boolean =>
  !e || e.state === "retroceso" || e.state === "en_zona";

const VERB: Record<EntryTiming["state"], string> = {
  retroceso: "comprar ahora",
  en_zona: "comprar ahora",
  esperar_retroceso: "esperar",
  esperar_confirmacion: "esperar",
};

/** Una sola frase, la misma en la tabla y en la ficha, para que no haya dos versiones del mismo consejo. */
export function entrySentence(e: EntryTiming): string {
  if (e.state === "retroceso") return `Comprar ahora, hasta ${f2(e.high)}: ${e.why}.`;
  if (e.state === "en_zona") return `Comprar ahora, entre ${f2(e.low)} y ${f2(e.high)}: ${e.why}.`;
  if (e.state === "esperar_retroceso")
    return `No comprar hoy: ${e.why}, válida ${e.validSessions} ruedas. Si no baja, se vuelve a evaluar.`;
  return `No comprar hoy: ${e.why}. Orden de compra recién arriba de ${f2(e.level)}, válida ${e.validSessions} ruedas.`;
}

/** Celda de tabla: verbo, precio y referencia. El detalle completo va en el title. */
export function EntryCell({ e, fallback }: { e?: EntryTiming | null; fallback?: React.ReactNode }) {
  if (!e) return <>{fallback ?? <span className="muted">—</span>}</>;
  const now = entryIsNow(e);
  return (
    <span title={entrySentence(e)}>
      <span className={now ? "ok" : "warn"} style={{ fontWeight: 600 }}>{VERB[e.state]}</span>{" "}
      <span className="mono">{now ? `${f2(e.low)}–${f2(e.high)}` : f2(e.level)}</span>
      {!now && <div className="muted" style={{ fontSize: 11 }}>{e.levelLabel} · {e.validSessions} ruedas</div>}
    </span>
  );
}

/** Renglón de la ficha: la frase completa más los dos números que la sostienen. */
export function EntryLine({ e }: { e?: EntryTiming | null }) {
  if (!e) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <b>Cuándo entrar:</b> <span className={entryIsNow(e) ? "ok" : "warn"}>{entrySentence(e)}</span>
      <div className="muted mono" style={{ fontSize: 12 }}>
        media de 20 {f2(e.sma20)} · media de 50 {f2(e.sma50)} · ATR 14 {f2(e.atr14)} · extensión {e.extensionAtr} ATR
        {e.rangePct60 !== null && <> · {e.rangePct60}% del rango de 60 ruedas</>}
      </div>
    </div>
  );
}
