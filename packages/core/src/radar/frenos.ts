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
export interface FilaMedida { symbol: string; candidateDate: string; kind: string; verdict: string; flags: string[]; alpha7dPct: number | null; alpha30dPct: number | null; alpha90dPct: number | null; verification?: { promptVersion?: string | null } | null }
export interface GrupoDeFreno {
  clave: string;
  titulo: string;
  /** Filas medidas (una por símbolo y día) y símbolos distintos: 20 filas de 4 símbolos no son 20 observaciones. */
  n: number;
  simbolos: number;
  /** Alfa promedio contra el S&P, en %, y % de filas que le ganaron. null sin filas. */
  alfa: number | null;
  acierto: number | null;
  /** Alfa del grupo menos el de su base: positivo = lo que el grupo contiene rindió más que lo que pasó. */
  contraSinFreno: number | null;
  /**
   * Contra qué base se comparó (7/10). "compra" = las COMPRAR que ningún freno tocó; "todas" = todas las filas sin
   * freno, cualquier veredicto (las listas de líderes, que incluyen lo que la técnica frena por no perseguir).
   * Los grupos con base distinta NO son comparables entre sí, y por eso cada uno la dice.
   */
  base: "compra" | "todas";
  /** El alfa de esa base, para poder auditar la resta sin recalcularla. */
  alfaBase: number | null;
  pocasFilas: boolean;
  lista: string[];
}
/** Con menos símbolos distintos que esto, el promedio es ruido y se dice. */
export const FRENOS_MINIMO_SIMBOLOS = 10;
const TECNICA = ["bajo_sma200", "bajo_stop", "no_perseguir", "sin_historial"];
const FRENOS = Object.keys(PLAN_BLOCKERS);
const AVISOS: Record<string, string> = { verificacion_apta: "verificación web apta", verificacion_reservas: "verificación web con reservas", verificacion_evitar: "verificación web dice evitar" };
/**
 * 24/9: desde el 22/9 verifica el agente (`/verificar`), pero las filas siguen arrastrando el veredicto de Gemini hasta
 * que el agente vuelve a mirar ese símbolo: el 24/9, 25 de 49 filas verificadas traían uno de Gemini, alguno del 12/9.
 * Medido junto, el juicio del 12/10 sobre el agente sería sobre todo un juicio sobre Gemini. Sin versión, no es del agente.
 */
const esDelAgente = (f: FilaMedida) => f.verification?.promptVersion?.startsWith("agente") === true;
const LIDERES: Record<string, string> = { lider_en_retroceso: "líder en retroceso (lo que la lista habría comprado)", lider_esperando: "líder esperando su retroceso" };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function medirFrenos(filas: FilaMedida[], horizonte: 7 | 30 | 90): { horizonte: number; desde: string | null; hasta: string | null; sinMedir: number; grupos: GrupoDeFreno[] } {
  const alfaDe = (f: FilaMedida) => (horizonte === 7 ? f.alpha7dPct : horizonte === 30 ? f.alpha30dPct : f.alpha90dPct);
  const comprables = filas.filter((f) => (f.kind === "stock" || f.kind === "watch") && !f.flags.some((x) => TECNICA.includes(x)));
  const medidas = comprables.filter((f) => alfaDe(f) !== null);
  const grupo = (clave: string, titulo: string, xs: FilaMedida[], base: "compra" | "todas" = "compra"): GrupoDeFreno => {
    const alfas = xs.map((f) => alfaDe(f)!);
    const lista = [...new Set(xs.map((f) => f.symbol))].sort();
    return { clave, titulo, n: xs.length, simbolos: lista.length, alfa: alfas.length ? r2(alfas.reduce((a, b) => a + b, 0) / alfas.length) : null, acierto: alfas.length ? Math.round((100 * alfas.filter((a) => a > 0).length) / alfas.length) : null, contraSinFreno: null, base, alfaBase: null, pocasFilas: lista.length < FRENOS_MINIMO_SIMBOLOS, lista };
  };
  const sinUnFreno = (f: FilaMedida) => !f.flags.some((x) => FRENOS.includes(x));
  // Todas las filas con alfa, sin el filtro de la técnica: las listas de líderes (21/9) se miden sobre esta población
  // porque "esperando" incluye justamente lo que la técnica frena por no perseguir.
  const todasMedidas = filas.filter((f) => (f.kind === "stock" || f.kind === "watch") && alfaDe(f) !== null);
  const promedio = (xs: FilaMedida[]) => (xs.length ? r2(xs.map((f) => alfaDe(f)!).reduce((a, b) => a + b, 0) / xs.length) : null);
  /**
   * La base de un grupo (7/10): SU MISMA POBLACIÓN, sin freno, y sin la etiqueta del grupo. Antes había una sola base
   * —las COMPRAR sin freno— y se la restaba a todos, lo que producía dos errores:
   *  - un AVISO ("verificación apta") no es un freno, así que sus filas también estaban en la base: se comparaba en
   *    parte contra sí mismo. Y medido sobre todos los veredictos arrastraba OBSERVAR que nunca fueron comprables,
   *    por lo que "apta" aparecía PEOR que la base midiendo otra cosa.
   *  - los LÍDERES viven en otra población (incluyen `no_perseguir`) y contra la base de COMPRAR tenían una ventaja
   *    inventada: +4,99 puntos en la corrida real del 7/10.
   */
  const base = (poblacion: FilaMedida[], etiqueta: string | null, soloCompra: boolean) =>
    promedio(poblacion.filter((f) => (!soloCompra || f.verdict === "COMPRAR") && sinUnFreno(f) && (etiqueta === null || !f.flags.includes(etiqueta))));
  const sinFreno = grupo("sin_freno", "COMPRAR que ningún freno tocó", medidas.filter((f) => f.verdict === "COMPRAR" && sinUnFreno(f)));
  // Un freno se compara contra las COMPRAR que pasaron: que el veredicto baje ES el efecto del freno, no un sesgo.
  const porFreno = FRENOS.map((k) => grupo(k, PLAN_BLOCKERS[k]!.split(":")[0]!, medidas.filter((f) => f.flags.includes(k))));
  const porAviso = Object.entries(AVISOS).flatMap(([k, t]) => [
    grupo(k, t, medidas.filter((f) => f.verdict === "COMPRAR" && f.flags.includes(k))),
    grupo(`${k}_agente`, `${t}, solo del agente`, medidas.filter((f) => f.verdict === "COMPRAR" && f.flags.includes(k) && esDelAgente(f))),
  ]);
  const porLider = Object.entries(LIDERES).map(([k, t]) => grupo(k, t, todasMedidas.filter((f) => f.flags.includes(k)), "todas"));
  for (const g of [...porFreno, ...porAviso, ...porLider]) {
    const etiqueta = g.clave.endsWith("_agente") ? g.clave.slice(0, -"_agente".length) : g.clave;
    g.alfaBase = g.base === "todas" ? base(todasMedidas, etiqueta, false) : base(medidas, etiqueta, true);
    g.contraSinFreno = g.alfa !== null && g.alfaBase !== null ? r2(g.alfa - g.alfaBase) : null;
  }
  const fechas = medidas.map((f) => f.candidateDate).sort();
  return { horizonte, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null, sinMedir: comprables.length - medidas.length, grupos: [sinFreno, ...porFreno, ...porAviso, ...porLider] };
}
