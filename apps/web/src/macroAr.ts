/**
 * Qué fechas puede afirmar la pantalla sobre el riesgo país (2026-10-06).
 *
 * El valor se guardaba con la fecha de la CORRIDA y se descartaba la que trae la fuente, así que la serie
 * quedaba corrida un día hábil entera: coincidía con el día hábil ANTERIOR de argentinadatos en 20 de 20
 * fechas comparables. El encabezado mostraba "655 · +3,0% vs 2026-10-02" cuando 655 era del viernes 2/10 y el
 * 636 contra el que comparaba era del 1/10: las dos fechas mal.
 *
 * Regla: se afirma sólo lo que está guardado. Si falta la fecha del dato —las filas anteriores al arreglo
 * quedaron en NULL a propósito— la pantalla no dice de cuándo es ni contra qué compara. Caer en la fecha de
 * la corrida era justamente la mentira.
 */
export interface RiesgoPaisFechas {
  /** Rueda del dato, sólo si difiere de la fecha de la corrida (si coincide, no hay nada que aclarar). */
  delDato: string | null;
  /** Rueda del dato contra el que se mide la variación. Null si no se sabe: entonces no se muestra. */
  contra: string | null;
}

type Fila = { date: string; riesgoPaisDate?: string | null };

export function riesgoPaisFechas(m: Fila, prev: Fila | undefined): RiesgoPaisFechas {
  const propia = m.riesgoPaisDate ?? null;
  return {
    delDato: propia !== null && propia !== m.date ? propia : null,
    contra: prev?.riesgoPaisDate ?? null,
  };
}
