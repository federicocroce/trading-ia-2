/**
 * Traducción de los tags XBRL de la SEC (13/9). La columna "extraordinarios" de la ficha mostraba el nombre
 * crudo del tag: "GainLossOnInvestments 15936.0M, InventoryWriteDown -800.0M". Eso no es información para
 * quien lee: es el identificador interno del dato. Y justo esa columna es la que explica por qué el P/E
 * declarado no sirve y el sistema usa el del núcleo, así que era la que más falta hacía entender.
 *
 * Caso real, NVDA al 2026-04-26: +15.936 M de revalorización de inversiones y −800 M de baja de inventario.
 * El primero no es plata que produjo el negocio de vender chips; el segundo sí es un costo del negocio.
 */
const ETIQUETAS: Record<string, string> = {
  GainLossOnDispositionOfAssets: "venta de activos",
  GainLossOnDispositionOfAssets1: "venta de activos",
  GainLossOnSaleOfBusiness: "venta de una unidad de negocio",
  GainLossOnDispositionOfIntangibleAssets: "venta de intangibles",
  GainLossOnSaleOfPropertyPlantEquipment: "venta de plantas o equipos",
  GainsLossesOnExtinguishmentOfDebt: "cancelación anticipada de deuda",
  DeconsolidationGainOrLossAmount: "salida de una filial del balance",
  BusinessCombinationBargainPurchaseGainRecognizedAmount: "compra por debajo de su valor",
  OtherNonrecurringGain: "otra ganancia no recurrente",
  GainLossOnSaleOfProperties: "venta de propiedades",
  GainsLossesOnSalesOfInvestmentRealEstate: "venta de inmuebles de inversión",
  GainLossOnInvestments: "resultado por inversiones",
  UnrealizedGainLossOnInvestments: "revalorización de inversiones (no vendidas)",
  EquitySecuritiesFvNiGainLoss: "revalorización de acciones en cartera",
  AssetImpairmentCharges: "deterioro de activos",
  ImpairmentOfLongLivedAssetsHeldForUse: "deterioro de activos de largo plazo",
  ImpairmentOfIntangibleAssetsExcludingGoodwill: "deterioro de intangibles",
  ImpairmentOfIntangibleAssetsFinitelived: "deterioro de intangibles",
  GoodwillImpairmentLoss: "deterioro del valor llave",
  RestructuringCharges: "reestructuración",
  LitigationSettlementExpense: "acuerdo judicial",
  InventoryWriteDown: "baja de inventario",
  SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense: "reservas de siniestros de años anteriores",
};

/** Nombre legible del tag. Si aparece uno nuevo se devuelve tal cual: es preferible a esconderlo. */
export const extraordinarioLabel = (tag: string): string => ETIQUETAS[tag] ?? tag;

export const EXTRAORDINARIOS_AYUDA =
  "Resultados que están en la ganancia declarada pero no vienen de vender el producto de la empresa: venta de activos, revalorización de inversiones, deterioros, juicios. Positivo infla la ganancia; negativo la hunde. El sistema los resta para calcular la ganancia núcleo y el P/E núcleo, que es el que usa para puntuar.";
