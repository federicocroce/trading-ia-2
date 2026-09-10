/** Etiquetas de las banderas del Radar. Lo que no está acá se muestra crudo. */
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
};
export const flagLabel = (flag: string): string => FLAG_LABEL[flag] ?? flag;
