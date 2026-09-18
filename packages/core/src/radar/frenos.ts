import { PLAN_BLOCKERS } from "./plan.js";

/**
 * Qué pasó con lo que cada freno dejó afuera (18/9). Del 10/9 al 17/9 se agregó casi una regla por día y casi todas
 * frenan; cada una salió de un caso real y ninguna se midió. Con lo que la app ya guarda —el alfa de cada fila contra el
 * S&P a 7, 30 y 90 días— se compara lo que ningún freno tocó con lo que cada freno dejó afuera. Un freno cuyas
 * excluidas rinden MÁS que las que dejó pasar está costando plata; uno cuyas excluidas rinden menos, protege.
 *
 * Solo acciones que la técnica dejaba comprar: una fila bajo su media de 200 no la frenó la regla de precio.
 * Es una medición, no una regla: no cambia ningún veredicto. Puro.
 */
export interface FilaMedida { symbol: string; candidateDate: string; kind: string; verdict: string; flags: string[]; alpha7dPct: number | null; alpha30dPct: number | null; alpha90dPct: number | null }
export interface GrupoDeFreno {
  clave: string;
  titulo: string;
  /** Filas medidas (una por símbolo y día) y símbolos distintos: 20 filas de 4 símbolos no son 20 observaciones. */
  n: number;
  simbolos: number;
  /** Alfa promedio contra el S&P, en %, y % de filas que le ganaron. null sin filas. */
  alfa: number | null;
  acierto: number | null;
  /** Alfa del grupo menos el de "sin freno": positivo = lo que el freno dejó afuera rindió más que lo que pasó. */
  contraSinFreno: number | null;
  pocasFilas: boolean;
  lista: string[];
}
/** Con menos símbolos distintos que esto, el promedio es ruido y se dice. */
export const FRENOS_MINIMO_SIMBOLOS = 10;
const TECNICA = ["bajo_sma200", "bajo_stop", "no_perseguir", "sin_historial"];
const FRENOS = Object.keys(PLAN_BLOCKERS);
const AVISOS: Record<string, string> = { verificacion_apta: "verificación web apta", verificacion_reservas: "verificación web con reservas", verificacion_evitar: "verificación web dice evitar" };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function medirFrenos(filas: FilaMedida[], horizonte: 7 | 30 | 90): { horizonte: number; desde: string | null; hasta: string | null; sinMedir: number; grupos: GrupoDeFreno[] } {
  const alfaDe = (f: FilaMedida) => (horizonte === 7 ? f.alpha7dPct : horizonte === 30 ? f.alpha30dPct : f.alpha90dPct);
  const comprables = filas.filter((f) => (f.kind === "stock" || f.kind === "watch") && !f.flags.some((x) => TECNICA.includes(x)));
  const medidas = comprables.filter((f) => alfaDe(f) !== null);
  const grupo = (clave: string, titulo: string, xs: FilaMedida[]): GrupoDeFreno => {
    const alfas = xs.map((f) => alfaDe(f)!);
    const lista = [...new Set(xs.map((f) => f.symbol))].sort();
    return { clave, titulo, n: xs.length, simbolos: lista.length, alfa: alfas.length ? r2(alfas.reduce((a, b) => a + b, 0) / alfas.length) : null, acierto: alfas.length ? Math.round((100 * alfas.filter((a) => a > 0).length) / alfas.length) : null, contraSinFreno: null, pocasFilas: lista.length < FRENOS_MINIMO_SIMBOLOS, lista };
  };
  const sinFreno = grupo("sin_freno", "COMPRAR que ningún freno tocó", medidas.filter((f) => f.verdict === "COMPRAR" && !f.flags.some((x) => FRENOS.includes(x))));
  const porFreno = FRENOS.map((k) => grupo(k, PLAN_BLOCKERS[k]!.split(":")[0]!, medidas.filter((f) => f.flags.includes(k))));
  const porAviso = Object.entries(AVISOS).map(([k, t]) => grupo(k, t, medidas.filter((f) => f.flags.includes(k))));
  for (const g of [...porFreno, ...porAviso]) g.contraSinFreno = g.alfa !== null && sinFreno.alfa !== null ? r2(g.alfa - sinFreno.alfa) : null;
  const fechas = medidas.map((f) => f.candidateDate).sort();
  return { horizonte, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null, sinMedir: comprables.length - medidas.length, grupos: [sinFreno, ...porFreno, ...porAviso] };
}
