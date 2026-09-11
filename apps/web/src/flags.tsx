/**
 * Banderas del Radar: etiqueta y signo.
 *
 * Hasta el 2026-09-11 todas se pintaban igual, con el mismo símbolo de advertencia y el mismo gris.
 * "consenso de compra" y "verificación web: apta" son buenas noticias y se leían como salvedades, así que
 * una candidata sana parecía llena de problemas y el veredicto COMPRAR no se le creía. El signo importa
 * tanto como el texto: sin él, la pantalla dice lo contrario de lo que dice el cálculo.
 */
const FLAG_LABEL: Record<string, string> = {
  consenso_compra: "consenso de compra",
  consenso_venta: "consenso de venta",
  insiders_compran: "insiders compran",
  insiders_venden: "insiders venden",
  sorpresa_positiva: "sorpresa positiva",
  sorpresa_negativa: "sorpresa negativa",
  dividendo: "dividendo",
  no_perseguir: "no perseguir (+15% en 21 ruedas)",
  resultados_cerca: "resultados en ≤ 10 días",
  residente_cronico: "residente crónico",
  bajo_stop: "bajo el stop dinámico",
  bajo_sma200: "bajo la SMA200",
  sin_historial: "sin 200 velas de historial",
  resultado_extraordinario: "ganancia con extraordinarios (ranking con núcleo)",
  sin_estados: "sin estados de la SEC",
  evento_grave: "evento grave en 90 días",
  evento_moderado: "evento moderado en 90 días",
  eventos_sin_clasificar: "titulares sin clasificar",
  interes_minoritario: "socios minoritarios se llevan ≥ 20% de la ganancia",
  cobranza_lenta: "cuentas a cobrar ≥ 35% de los ingresos",
  ganancia_sin_ventas: "último trimestre: menos ventas, mucha más ganancia",
  salvedades_de_calidad: "dos o más salvedades de calidad o litigio",
  verificacion_apta: "verificación web: apta",
  verificacion_reservas: "verificación web: con reservas",
  verificacion_evitar: "verificación web: evitar",
  verificacion_pendiente: "verificación web pendiente",
  consenso_en_precio: "objetivo de consenso a < 10% del precio",
  subio_mucho_12m: "subió > 100% en 12 meses",
};
export const flagLabel = (flag: string): string => FLAG_LABEL[flag] ?? flag;

export type FlagTone = "bueno" | "salvedad" | "limitacion";

/** Señales a favor. Ninguna de estas resta en la convicción ni acerca a OBSERVAR. */
const BUENAS = new Set(["consenso_compra", "insiders_compran", "sorpresa_positiva", "dividendo", "verificacion_apta"]);
/** Ni a favor ni en contra: falta un dato. No es un defecto de la empresa, es un límite de la fuente. */
const LIMITACIONES = new Set(["sin_estados", "sin_historial", "eventos_sin_clasificar", "verificacion_pendiente"]);

/** Todo lo que no está declarado como bueno o como límite cuenta como salvedad: el default seguro. */
export function flagTone(flag: string): FlagTone {
  if (BUENAS.has(flag)) return "bueno";
  if (LIMITACIONES.has(flag)) return "limitacion";
  return "salvedad";
}

const MARCA: Record<FlagTone, string> = { bueno: "✓", salvedad: "⚑", limitacion: "·" };
const TITULO: Record<FlagTone, string> = {
  bueno: "A favor: suma a la convicción.",
  salvedad: "Salvedad: resta convicción y, con dos de calidad, pasa a OBSERVAR.",
  limitacion: "Falta el dato: ni a favor ni en contra.",
};

/** Cuántas salvedades reales tiene, que es lo único que hay que contar para decidir. */
export const countSalvedades = (flags: string[]): number => flags.filter((f) => flagTone(f) === "salvedad").length;

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
          <span key={f} className={`flag ${t}`} title={TITULO[t]}>
            {inline ? "" : `${MARCA[t]} `}
            {flagLabel(f)}
          </span>
        );
      })}
    </>
  );
}
