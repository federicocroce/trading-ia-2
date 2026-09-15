import type { EntryTiming } from "./api";
import { entrySentence, entryVerb } from "./orden";

/**
 * Cuándo entrar. El Radar decía QUÉ comprar y a qué precio máximo, pero no si hoy era el día:
 * entrar en una acción buena justo cuando está 3 ATR arriba de su media es comprar el envión.
 * Acá se muestra el estado, el precio y hasta cuándo vale la condición.
 *
 * `enPlan`: el plan vigente la compra hoy. Sin eso no se dice "comprar ahora" (15/9: la celda lo decía en verde a SNDK
 * y el plan no la compraba). La frase y el verbo viven en `orden.ts`, sin JSX, para poder probarlos.
 */
const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

export const entryIsNow = (e: EntryTiming | null | undefined): boolean =>
  !e || e.state === "retroceso" || e.state === "en_zona";

export { entrySentence };

/** Celda de tabla: verbo, precio y referencia. El detalle completo va en el title. */
export function EntryCell({ e, fallback, enPlan = false }: { e?: EntryTiming | null; fallback?: React.ReactNode; enPlan?: boolean }) {
  if (!e) return <>{fallback ?? <span className="muted">—</span>}</>;
  const now = entryIsNow(e);
  const v = entryVerb(e, enPlan);
  return (
    <span title={entrySentence(e, enPlan)}>
      <span className={v.tone} style={{ fontWeight: 600 }}>{v.text}</span>{" "}
      <span className="mono">{now ? `${f2(e.low)}–${f2(e.high)}` : f2(e.level)}</span>
      {!now && <div className="muted" style={{ fontSize: 11 }}>{e.state === "esperar_retroceso" ? "orden limitada · " : "al cierre · "}{e.levelLabel} · {e.validSessions} ruedas</div>}
    </span>
  );
}

/** Renglón de la ficha: la frase completa más los dos números que la sostienen. */
export function EntryLine({ e, enPlan = false }: { e?: EntryTiming | null; enPlan?: boolean }) {
  if (!e) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <b>Cuándo entrar:</b> <span className={entryVerb(e, enPlan).tone}>{entrySentence(e, enPlan)}</span>
      <div className="muted mono" style={{ fontSize: 12 }}>
        media de 20 {f2(e.sma20)} · media de 50 {f2(e.sma50)} · ATR 14 {f2(e.atr14)} · extensión {e.extensionAtr} ATR
        {e.rangePct60 !== null && <> · {e.rangePct60}% del rango de 60 ruedas</>}
      </div>
    </div>
  );
}
