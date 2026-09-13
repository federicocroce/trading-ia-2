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

const [candidatos, plan, veredictos, novedades, posiciones, movimientos] = await Promise.all([
  pedir<Pantallas["candidatos"]>("/radar/candidates", []),
  pedir<Pantallas["plan"]>("/radar/plan", null),
  pedir<Pantallas["veredictos"]>("/cartera/verdicts", []),
  pedir<Pantallas["novedades"]>("/novedades", null),
  pedir<NonNullable<Pantallas["posiciones"]>>("/cartera/positions", []),
  pedir<NonNullable<Pantallas["movimientos"]>>("/cartera/transactions", []),
]);

const pantallas: Pantallas = {
  candidatos: candidatos ?? [],
  plan: plan ?? null,
  veredictos: veredictos ?? [],
  posiciones: posiciones ?? [],
  movimientos: movimientos ?? [],
  ...(novedades ? { novedades } : {}),
};

console.log(`[auditar] Radar ${pantallas.candidatos.length} candidatos · plan ${pantallas.plan?.lines.length ?? 0} líneas · Cartera ${pantallas.veredictos.length} posiciones · ${pantallas.movimientos?.length ?? 0} movimientos`);

const findings = checkPantallas(pantallas);
const { graves, avisos } = summarizeFindings(findings);
if (!findings.length) console.log("[auditar] las pantallas no se contradicen entre sí");
else {
  console.log(`[auditar] ${graves} graves y ${avisos} avisos`);
  for (const f of findings) console.log(`[auditar] ${f.severity === "grave" ? "GRAVE" : "aviso"} ${f.check} ${f.symbol ?? ""}: ${f.detail}`);
}
process.exit(graves > 0 ? 1 : 0);
