/**
 * Auditoría de pantallas: pide a la API exactamente lo mismo que pide el navegador y verifica que las
 * pantallas no se contradigan entre sí.
 *
 * Por qué existe. Los tests comparan el código contra su especificación; `radar-cli consistencia` compara
 * cada fila contra sus fuentes. Ninguno de los dos mira si DOS PANTALLAS dicen lo mismo del mismo símbolo,
 * que es lo que el usuario ve. El pedido fue textual: si en una pantalla una acción figura como compra, en
 * otra no puede figurar como venta.
 *
 * Uso: tsx src/auditar.ts [url]   (por defecto http://localhost:3002)
 * Sale con código 1 si hay algo grave, para poder colgarlo de un cron o de un hook.
 */
import { checkPantallas, summarizeFindings, type Pantallas } from "@thesis/core";

const base = (process.argv[2] ?? "http://localhost:3002").replace(/\/$/, "");

async function pedir<T>(ruta: string, porDefecto: T): Promise<T> {
  try {
    const r = await fetch(`${base}${ruta}`);
    if (!r.ok) {
      console.log(`[auditar] ${ruta} respondió ${r.status}`);
      return porDefecto;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.log(`[auditar] ${ruta} falló: ${String(e).slice(0, 120)}`);
    return porDefecto;
  }
}

const [candidatos, plan, veredictos, novedades, posiciones, movimientos, top] = await Promise.all([
  pedir<Pantallas["candidatos"]>("/radar/candidates", []),
  pedir<Pantallas["plan"]>("/radar/plan", null),
  pedir<Pantallas["veredictos"]>("/cartera/verdicts", []),
  pedir<Pantallas["novedades"]>("/novedades", null),
  pedir<NonNullable<Pantallas["posiciones"]>>("/cartera/positions", []),
  pedir<NonNullable<Pantallas["movimientos"]>>("/cartera/transactions", []),
  // "Lo que más recomienda hoy": el "2 a 1" que dice la tarjeta tiene que salir de los % que muestra al lado.
  pedir<{ picks: NonNullable<Pantallas["top"]> } | null>("/radar/top?n=20", null),
]);

// Gráfico de la ficha de cada símbolo del plan: la última vela del diario contra la última sesión del intradiario.
const diaUtc = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const graficos = await Promise.all((plan?.lines ?? []).map(async (l) => {
  const [diario, intradiario] = await Promise.all([
    pedir<Array<{ time: number }>>(`/ticker/${l.symbol}/chart?range=3mo&interval=1d`, []),
    pedir<Array<{ time: number }>>(`/ticker/${l.symbol}/chart?range=1d&interval=5m`, []),
  ]);
  const ultima = (b: Array<{ time: number }>) => (Array.isArray(b) && b.length ? diaUtc(b[b.length - 1]!.time) : null);
  return { symbol: l.symbol, ultimaDiaria: ultima(diario), ultimaIntradiaria: ultima(intradiario) };
}));

const pantallas: Pantallas = {
  candidatos: candidatos ?? [],
  plan: plan ?? null,
  veredictos: veredictos ?? [],
  posiciones: posiciones ?? [],
  movimientos: movimientos ?? [],
  top: top?.picks ?? [],
  graficos,
  ...(novedades ? { novedades } : {}),
};

console.log(`[auditar] Radar ${pantallas.candidatos.length} candidatos · plan ${pantallas.plan?.lines.length ?? 0} líneas · Cartera ${pantallas.veredictos.length} posiciones · ${pantallas.movimientos?.length ?? 0} movimientos · ${pantallas.top?.length ?? 0} recomendadas · ${graficos.filter((g) => g.ultimaDiaria && g.ultimaIntradiaria).length} gráficos comparables`);

const findings = checkPantallas(pantallas);
const { graves, avisos } = summarizeFindings(findings);
if (!findings.length) console.log("[auditar] las pantallas no se contradicen entre sí");
else {
  console.log(`[auditar] ${graves} graves y ${avisos} avisos`);
  for (const f of findings) console.log(`[auditar] ${f.severity === "grave" ? "GRAVE" : "aviso"} ${f.check} ${f.symbol ?? ""}: ${f.detail}`);
}
process.exit(graves > 0 ? 1 : 0);
