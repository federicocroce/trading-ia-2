import { countSalvedades, flagLabel, flagTitle, flagTone, type FlagTone } from "./flagLabels";

/**
 * Banderas del Radar, la parte que dibuja. La lógica de etiqueta y signo vive en `flagLabels.ts`, sin JSX,
 * para poder probarla: es la que decide si una bandera se lee como advertencia o como dato a favor, y ese
 * fue justamente el error del 11/9 (todo pintado igual) y el del 13/9 (frases crudas en ámbar).
 */
export { countSalvedades, flagLabel, flagTone };
export type { FlagTone };

const MARCA: Record<FlagTone, string> = { bueno: "\u2713", salvedad: "\u2691", limitacion: "\u00b7" };

/** Banderas con su signo. `inline` para la celda angosta de una tabla, sin marca ni salto. */
export function Flags({ flags, inline = false }: { flags: string[]; inline?: boolean }) {
  if (!flags.length) return inline ? null : <span className="muted" style={{ fontSize: 11 }}>sin banderas</span>;
  const orden: FlagTone[] = ["salvedad", "limitacion", "bueno"];
  const ordenadas = [...flags].sort((a, b) => orden.indexOf(flagTone(a)) - orden.indexOf(flagTone(b)));
  return (
    <>
      {ordenadas.map((f) => {
        const t = flagTone(f);
        return (
          <span key={f} className={`flag ${t}`} title={flagTitle(f)}>
            {inline ? "" : `${MARCA[t]} `}
            {flagLabel(f)}
          </span>
        );
      })}
    </>
  );
}
