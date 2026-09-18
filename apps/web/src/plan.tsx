import { useEffect, useState } from "react";
import { api, isHistorical, type ContributionPlan, type Verb } from "./api";
import { controlesBloquean, instruccionCartera, instruccionRadar, planStatusFor, type Instruccion } from "./instruccion";

/**
 * El plan vigente, compartido por todas las pantallas (14/9). Cada etiqueta de COMPRAR o SUMAR sale de acá: si la
 * pantalla no tiene el plan, no puede decir COMPRAR. Cuando alguien rearma el plan se avisa con "plan:changed".
 */
let cache: Promise<ContributionPlan | null> | null = null;
export const invalidatePlan = () => { cache = null; window.dispatchEvent(new Event("plan:changed")); };
/** Mientras los controles no revisaron el plan vigente, se vuelve a pedir: corren solos en menos de un minuto. */
let reintento: ReturnType<typeof setTimeout> | null = null;
const esperarControles = (p: ContributionPlan | null) => {
  if (reintento || !p || !p.lines.length) return;
  const pendiente = !p.controles || p.controles.planBuiltAt !== p.builtAt;
  if (pendiente && controlesBloquean(p)) reintento = setTimeout(() => { reintento = null; invalidatePlan(); }, 15_000);
};

export function usePlan(): ContributionPlan | null {
  const [plan, setPlan] = useState<ContributionPlan | null>(null);
  useEffect(() => {
    let vivo = true;
    const load = () => { cache ??= api.radar.plan().catch(() => null); void cache.then((p) => { if (vivo) setPlan(p); esperarControles(p); }); };
    load();
    const onChange = () => { cache = null; load(); };
    window.addEventListener("plan:changed", onChange);
    return () => { vivo = false; window.removeEventListener("plan:changed", onChange); };
  }, []);
  return plan;
}

/** Etiqueta única de un veredicto. `detail` al lado, apagado; en modo histórico no hay plan que lo respalde. */
export function InstruccionChip({ ins, detail = true, small = false }: { ins: Instruccion; detail?: boolean; small?: boolean }) {
  return (
    <>
      <span className={`verb ${ins.tone}`} style={small ? { fontSize: 10, padding: "0 6px" } : undefined} title={ins.detail ?? undefined}>{ins.label}{ins.avisos ? " ⚠" : ""}</span>
      {detail && ins.detail && <span className="muted" style={{ fontSize: 12 }}> {ins.detail}</span>}
    </>
  );
}

/** Veredicto del Radar tal como se muestra: COMPRAR solo si el plan lo compra. */
export function RadarVerdict({ symbol, verdict, plan, context, detail, small }: { symbol: string; verdict: string; plan: ContributionPlan | null; context?: "argentina"; detail?: boolean; small?: boolean }) {
  // En modo histórico el plan vigente no corresponde a esa fecha: no se afirma ninguna compra.
  const status = isHistorical() ? null : planStatusFor(symbol, plan);
  return <InstruccionChip ins={instruccionRadar(verdict, status, context)} {...(detail !== undefined ? { detail } : {})} {...(small !== undefined ? { small } : {})} />;
}

/** Veredicto de Cartera tal como se muestra: SUMAR solo si el plan lo suma. */
export function CarteraVerdict({ symbol, verb, plan, detail, small }: { symbol: string; verb: Verb; plan: ContributionPlan | null; detail?: boolean; small?: boolean }) {
  const status = isHistorical() ? null : planStatusFor(symbol, plan);
  return <InstruccionChip ins={instruccionCartera(verb, status)} {...(detail !== undefined ? { detail } : {})} {...(small !== undefined ? { small } : {})} />;
}
