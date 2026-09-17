import type { HechoExterno } from "./api";
import { hechoLinea } from "./hechos";

/**
 * Hechos externos (17/9): lo que cargó el importador para este símbolo, con su estado y su fuente. Lo verificado
 * produce las banderas de la fila; lo no verificado se muestra igual, marcado, y no mueve nada.
 */
export function HechosCard({ hechos }: { hechos: HechoExterno[] }) {
  if (!hechos.length) return null;
  return (
    <div className="card">
      <b>Hechos externos</b> <span className="muted">· cargados por el importador; sólo los verificados (fuente primaria) cuentan en las banderas</span>
      {hechos.map((h) => {
        const l = hechoLinea(h);
        return (
          <div key={`${h.tipo}|${h.fecha}|${h.fuente.url}`} className="mono" style={{ marginTop: 4 }}>
            <span className={l.chip === "verificado" ? "ok" : "warn"}>{l.chip}</span> <span className="muted">{l.fecha} · {h.tipo.replace(/_/g, " ")} · {h.origen === "manual" ? "cargado a mano" : "cargado por el agente"}</span> · {l.texto} · <a href={l.fuente.url} target="_blank" rel="noreferrer">{l.fuente.titulo}</a>
          </div>
        );
      })}
    </div>
  );
}
