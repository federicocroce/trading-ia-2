import type { HechoExterno } from "./api";

const coma = (n: number) => String(n).replace(".", ",");
const millones = (usd: number) => `USD ${Math.round(usd / 1e6)} M`;

/** Texto de un hecho para la ficha. Mismo texto que `textoDeHecho` en el núcleo (el test de ahí es la referencia). */
export function textoDeHecho(h: HechoExterno): string {
  const v = h.valor as Record<string, unknown>;
  if (h.tipo === "guia") {
    const d = String(v["direccion"]);
    const verbo = d === "sube" ? "subió" : d === "baja" ? "recortó" : "reafirmó";
    return `${verbo} la guía el ${h.fecha}: ${String(v["metrica"])} ${(v["antes"] as string | null) ?? "—"} → ${(v["despues"] as string | null) ?? "—"}`;
  }
  if (h.tipo === "ganancia_por_reservas") {
    const consenso = v["epsConsenso"] as number | null;
    return `la ganancia del ${String(v["trimestre"])} lleva ${millones(Number(v["montoUsd"]))} de reservas liberadas: sin eso ${coma(Number(v["epsSinReservas"]))} contra ${consenso === null ? "—" : coma(consenso)} esperado`;
  }
  if (h.tipo === "ganancia_extraordinaria") {
    const consenso = v["epsConsenso"] as number | null;
    return `la ganancia del ${String(v["trimestre"])} lleva ${millones(Number(v["montoUsd"]))} de ${String(v["concepto"])}: sin eso ${coma(Number(v["epsSinExtraordinario"]))} contra ${consenso === null ? "—" : coma(consenso)} esperado`;
  }
  if (h.tipo === "investigacion_regulatoria") {
    const orgs = (v["organismos"] as string[] | undefined) ?? [];
    const quienes = orgs.length > 1 ? `${orgs.slice(0, -1).join(", ")} y ${orgs[orgs.length - 1]}` : (orgs[0] ?? "—");
    return `investigación ${String(v["estado"])} de ${quienes} (${String(v["asunto"])}); la empresa ${v["empresaAcusada"] ? "está acusada" : "no está acusada"}`;
  }
  const ratio = v["ratio"] as { acciones: number; de: string } | null;
  const efectivo = v["efectivoUsd"] as number | null;
  if (ratio) return `vale ${coma(ratio.acciones)} acciones de ${ratio.de} (${String(v["comprador"])}, ${String(v["etapa"])})`;
  return `vendida a ${efectivo === null ? "—" : coma(efectivo)} en efectivo (${String(v["comprador"])}, ${String(v["etapa"])})`;
}

export function hechoLinea(h: HechoExterno): { chip: "verificado" | "no verificado"; fecha: string; texto: string; fuente: { url: string; titulo: string } } {
  return { chip: h.estado === "verificado" ? "verificado" : "no verificado", fecha: h.fecha, texto: textoDeHecho(h), fuente: h.fuente };
}
