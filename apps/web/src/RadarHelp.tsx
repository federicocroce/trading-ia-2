/**
 * Ayuda del Radar: qué significa cada columna y cómo se combinan para decidir.
 * Tooltip corto en el título de la columna; explicación completa en el modal.
 */
export const HELP: Record<string, { label: string; short: string }> = {
  simbolo: { label: "símbolo", short: "Ticker. Click para abrir la ficha completa." },
  veredicto: { label: "veredicto", short: "COMPRAR: buena empresa y buen momento. OBSERVAR: buena empresa, mal momento (bajo la media de 200 ruedas, subió >15% en 21 ruedas, reporta en ≤10 días, bajo su stop o residente crónico)." },
  score: { label: "score", short: "Fundamentals contra sus pares, en desviaciones típicas: 0 = mediana del grupo, +1 claramente mejor, tope ±3. Pesos: valuación 35%, calidad 30%, crecimiento 25%, balance 10%. Es relativo, no dice que la acción vaya a subir." },
  rank: { label: "rank", short: "Posición por score dentro del grupo de comparación. 1/59 dice mucho; 1/5 dice poco: el denominador importa tanto como el numerador." },
  precio: { label: "precio", short: "Último cierre usado para calcular entrada, stop y objetivo." },
  entrada: { label: "entrada", short: "Rango para comprar: del cierre hasta +2%. Si el precio ya se escapó por arriba, no lo corras." },
  stop: { label: "stop", short: "Stop dinámico (chandelier 22 ruedas, 3 ATR): si cierra por debajo, la tesis se anuló. El % es lo que perdés desde el precio actual." },
  objetivo: { label: "objetivo", short: "Precio donde la operación paga 2 veces lo que arriesga hasta el stop. No es un pronóstico. El % es lo que ganás desde el precio actual." },
  tamano: { label: "tamaño", short: "Acciones y dólares para arriesgar 1% de la cartera hasta el stop, con tope del 10% de la cartera por posición. Un papel volátil tiene stop más lejos y por eso menos acciones." },
  riesgo: { label: "riesgo", short: "1 (tranquilo) a 10 (especulativo). Suma puntos por beta alta, rango diario amplio, deuda, poco volumen y capitalización chica. No es probabilidad de perder: dice cuánto te va a sacudir. No cambia el veredicto, cambia cuánto ponés." },
  etiquetas: { label: "etiquetas", short: "Clase de activo, sector y temas transversales. Editables; lo manual nunca se pisa." },
  fr3m: { label: "FR 3m", short: "Fuerza relativa contra SPY a 3 meses: cuánto le ganó (o perdió) al S&P 500." },
  fr6m: { label: "FR 6m", short: "Fuerza relativa contra SPY a 6 meses." },
  fr12m: { label: "FR 12m", short: "Fuerza relativa contra SPY a 12 meses." },
  sma200: { label: "vs SMA200", short: "Distancia al promedio móvil de 200 ruedas. Negativo = tendencia de fondo bajista, queda afuera." },
  adr: { label: "ADR", short: "El mismo papel cotizando en Nueva York, en dólares. Ahí están los fundamentals y el ranking contra pares." },
  frMerval: { label: "FR 6m vs Merval", short: "Fuerza relativa contra el índice Merval a 6 meses, en pesos: cuánto le ganó (o perdió) al mercado local. COMPRAR exige > 0 y estar sobre la SMA200." },
  precioArs: { label: "precio ARS", short: "Último cierre en pesos en BYMA." },
  precioUsd: { label: "precio USD", short: "El mismo cierre pasado a dólares al CCL del día." },
  ratio: { label: "ratio", short: "Cuántos CEDEARs equivalen a una acción en EE.UU. Cambia con los splits: si el dólar implícito se va más de 10% del CCL, el ratio cargado está mal." },
  dolarImplicito: { label: "dólar implícito", short: "Precio del CEDEAR × ratio / precio en EE.UU.: el dólar que pagás comprando la acción vía CEDEAR." },
  vsCcl: { label: "vs CCL", short: "Dólar implícito contra el CCL. Más de +2% el CEDEAR está caro; menos de −2% está barato. Más de 10% en cualquier sentido: ratio dudoso, no oportunidad." },
  conviccion: { label: "convicción", short: "score × fiabilidad del grupo (pares/10, tope 1) + 0.2 por consenso de compra, insiders que compran o sorpresa positiva − banderas negativas − 0.1 por punto de riesgo sobre 5 − 0.3 si el objetivo queda a menos de 5% − 0.3 si comparte un tema donde ya tenés más del 40% de la cartera." },
};

export function Th({ k, children }: { k: keyof typeof HELP; children?: React.ReactNode }) {
  const h = HELP[k]!;
  return <th title={h.short} className="help">{children ?? h.label}</th>;
}

export function RadarHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Cómo leer el Radar</h2>
          <button className="ghost" onClick={onClose}>Cerrar</button>
        </div>

        <h3>Score: qué tan buena es la empresa contra sus comparables</h3>
        <p>Compara los fundamentals del ticker contra su grupo de pares (mismo negocio según Finnhub; si no hay al menos 4, contra la industria). Cuatro ejes, cada uno con sus métricas:</p>
        <table>
          <thead><tr><th>eje</th><th>peso</th><th>métricas</th></tr></thead>
          <tbody>
            <tr><td>Valuación</td><td>35%</td><td>P/E, EV/EBITDA, P/S. Más barato es mejor.</td></tr>
            <tr><td>Calidad</td><td>30%</td><td>ROE, margen operativo, margen neto.</td></tr>
            <tr><td>Crecimiento</td><td>25%</td><td>Ingresos a 12 meses y 5 años, EPS a 12 meses.</td></tr>
            <tr><td>Balance</td><td>10%</td><td>Deuda sobre patrimonio, liquidez corriente.</td></tr>
          </tbody>
        </table>
        <p>Cada métrica se convierte en un z-score dentro del grupo: 0 es la mediana de los pares, +1 es una desviación típica mejor que el grupo, tope en ±3. El score es el promedio ponderado. Regla práctica: arriba de 1 es claramente mejor que los comparables, cerca de 0 es del montón, negativo es peor.</p>
        <p><b>Es relativo.</b> No dice que la empresa sea buena en términos absolutos ni que la acción vaya a subir. Dice que hoy es más barata, más rentable y crece más que las empresas con las que compite.</p>

        <h3>Rank: dónde queda dentro del grupo</h3>
        <p>Posición por score dentro del grupo. 1/11 es la mejor de 11 comparables. El denominador importa tanto como el numerador: ser 1 de 5 dice poco, con cinco empresas cualquiera puede ser primera; 1 de 59 dice mucho. Cuando no hay pares directos se compara contra toda la industria: gana un grupo amplio pero heterogéneo. En la ficha del ticker está la tabla contra pares para juzgarlo vos.</p>

        <h3>Riesgo 1 a 10: qué tan movida es la apuesta</h3>
        <p>No es probabilidad de perder. Mide cuánto te va a sacudir y qué tan frágil es el papel. Arranca en 1 y cada ingrediente suma 0, 1 o 2 puntos:</p>
        <table>
          <thead><tr><th>ingrediente</th><th>+1</th><th>+2</th></tr></thead>
          <tbody>
            <tr><td>Beta</td><td>&gt; 1.2</td><td>&gt; 1.5</td></tr>
            <tr><td>Rango diario (ATR %)</td><td>&gt; 2.5%</td><td>&gt; 4%</td></tr>
            <tr><td>Deuda / patrimonio</td><td>&gt; 0.8</td><td>&gt; 1.5</td></tr>
            <tr><td>Volumen diario</td><td>&lt; USD 25M</td><td>&lt; USD 10M</td></tr>
            <tr><td>Capitalización</td><td>&lt; USD 10B</td><td>&lt; USD 2B o desconocida</td></tr>
          </tbody>
        </table>
        <p>1/10 es grande, líquida, sin deuda y tranquila. 9/10 es chica, volátil, endeudada y poco líquida. El riesgo no cambia el veredicto, cambia cuánto ponés: el tamaño ya está calculado para arriesgar 1% de la cartera hasta el stop, con tope del 10% por posición. Un papel volátil tiene stop más lejos y por eso menos acciones.</p>

        <h3>Entrada, stop y objetivo</h3>
        <p><b>Entrada</b>: del cierre hasta +2%. <b>Stop</b>: chandelier de 22 ruedas y 3 ATR; si cierra por debajo, la tesis se anuló. <b>Objetivo</b>: el precio donde la operación paga 2 veces lo que arriesga hasta el stop. No es un pronóstico de ganancia: es 2 veces la distancia al stop. Los % al lado de cada uno son lo que perdés o ganás desde el precio actual.</p>

        <h3>Cómo se combinan para decidir si entrar</h3>
        <ol>
          <li><b>El veredicto es la puerta.</b> COMPRAR solo si pasó los filtros técnicos: por encima de la media de 200 ruedas, no subió más de 15% en 21 ruedas, no reporta en 10 días, no está bajo su stop, no es residente crónico (4ª semana seguida como candidato). OBSERVAR es "buena empresa, mal momento".</li>
          <li><b>Entre los COMPRAR, priorizá score alto con denominador grande en el rank.</b></li>
          <li><b>El riesgo te dice cuánto y qué esperar.</b> Un 9/10 es una apuesta: respetá el tamaño de la tabla, no lo agrandes porque el score es lindo.</li>
          <li><b>Entrá dentro del rango de entrada.</b> Si el precio ya se escapó por arriba, no lo corras.</li>
          <li><b>Cruzalo con la concentración de Cartera.</b> Si ya tenés más del 40% en un tema, dos candidatos más de ese tema no suman diversificación. El plan del aporte hace este cruce solo: núcleo primero, máximo 2 posiciones nuevas por mes, 50% del aporte por línea.</li>
        </ol>

        <h3>Convicción: "lo que más recomienda hoy"</h3>
        <p>Junta todo lo anterior en un número, sin agregar nada nuevo: score × fiabilidad del grupo (pares/10, tope 1), +0.2 por consenso de compra, insiders que compran o sorpresa positiva, −0.15/−0.3 por banderas negativas, −0.1 por cada punto de riesgo sobre 5, −0.3 si el objetivo queda a menos de 5%, −0.3 si comparte un tema donde ya tenés más del 40% de la cartera. "Todo acompaña" es cuando no hay ninguna salvedad.</p>

        <h3>ETFs</h3>
        <p><b>FR 3m / 6m / 12m</b>: fuerza relativa contra SPY, cuánto le ganó o perdió al S&amp;P 500 en ese plazo. <b>vs SMA200</b>: distancia al promedio de 200 ruedas. Los de núcleo (NUCLEO) se compran por calendario según el plan; satélites y coberturas salen COMPRAR u OBSERVAR por fuerza relativa.</p>

        <h3>Argentina</h3>
        <p>Las acciones de BYMA cotizan en pesos, así que se comparan contra el <b>Merval</b> y no contra SPY: COMPRAR si le ganan al índice a 6 meses y están sobre la media de 200 ruedas. No tienen score ni rank porque Finnhub no cubre el mercado local; cuando el papel tiene <b>ADR</b>, los fundamentals están en la ficha del ADR. El <b>precio USD</b> es el cierre en pesos al CCL del día. Los <b>CEDEARs</b> no son una recomendación: son un chequeo de a qué dólar estás comprando la acción de EE.UU. si la comprás en pesos. El <b>macro</b> (CCL, MEP, oficial, brecha, riesgo país, Merval en dólares) se guarda todos los días para tener la serie.</p>

        <p className="muted"><b>Advertencia honesta:</b> el score todavía no está validado. La medición a 7, 30 y 90 días contra SPY, con OBSERVAR como grupo de control, es la que va a decir si estos números anticipan algo. Hasta entonces es un buen filtro para saber dónde mirar, no una promesa.</p>
      </div>
    </div>
  );
}
