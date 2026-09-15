/**
 * Ayuda del Radar: qué significa cada columna y cómo se combinan para decidir.
 * Tooltip corto en el título de la columna; explicación completa en el modal.
 */
export const HELP: Record<string, { label: string; short: string }> = {
  simbolo: { label: "símbolo", short: "Ticker. Click para abrir la ficha completa." },
  veredicto: { label: "veredicto", short: "COMPRAR: está en el plan de hoy, con su monto; es la única orden de compra de la app, en cualquier pantalla. CANDIDATA: pasó los filtros del Radar (buena empresa, buen momento) pero el plan no la compra, y al lado dice por qué. OBSERVAR: buena empresa, mal momento (bajo la media de 200 ruedas, subió >15% en 21 ruedas, reporta en ≤10 días, bajo su stop o residente crónico)." },
  score: { label: "score", short: "Fundamentals contra sus pares, en desviaciones típicas: 0 = mediana del grupo, +1 claramente mejor, tope ±3. Pesos: valuación 35%, calidad 30%, crecimiento 25%, balance 10%. Es relativo, no dice que la acción vaya a subir." },
  rank: { label: "rank", short: "Posición por score dentro del grupo de comparación. 1/59 dice mucho; 1/5 dice poco: el denominador importa tanto como el numerador." },
  precio: { label: "precio", short: "Último cierre usado para calcular entrada, stop y objetivo." },
  entrada: { label: "entrada", short: "Cuándo y a qué precio. 'comprar ahora' solo si el plan de hoy la compra; si no, 'en zona' describe el momento sin ordenar nada. Si está estirada: 'esperar' con orden limitada en la media de 20 ruedas. Si cayó bajo su media de 50: 'si cierra arriba de' el nivel, que es una compra al cierre y no una orden limitada (el nivel está arriba del precio). La condición vale las ruedas que dice." },
  stop: { label: "stop", short: "Si cierra por debajo, se vende. Para una compra nueva: el más bajo entre el stop de seguimiento (máximo de 22 ruedas menos 3 ATR) y el piso de la franja menos 2,5 ATR, para que el ruido de un día no lo ejecute. El % se mide desde el techo de la franja, lo máximo que pagás, igual que el objetivo; si ya la tenés, desde el precio de hoy. El title del % dice la base." },
  objetivo: { label: "objetivo", short: "Precio donde una compra nueva paga 2 veces lo que arriesga hasta el stop, medido desde el techo de la franja. NO es una ganancia esperada ni un pronóstico: es aritmética sobre el stop, así que sube y baja con la volatilidad y no con la empresa (medido sobre los 26 COMPRAR del 11/9, la correlación entre el % al objetivo y la distancia al stop fue 1,0000). Si ya la tenés, dice 'si sumás desde' y al lado el objetivo de tu posición, que es el de Cartera." },
  objetivoEtf: { label: "objetivo", short: "Precio donde el ETF paga 2 veces lo que arriesga hasta el stop, medido desde la FRANJA DE COMPRA, no desde el precio de hoy. Por eso un ETF al que hay que esperarle un retroceso puede mostrar un objetivo por debajo del precio actual: si entrás 3% más abajo, el mismo 2 a 1 termina más abajo. Vacío = no hay operación posible (bajo el stop o con el stop dentro de la franja)." },
  tamano: { label: "tamaño", short: "Para una posición NUEVA: acciones y dólares para arriesgar 1% de la cartera hasta el stop, con tope del 10% de la cartera al entrar. Un papel volátil tiene stop más lejos y por eso menos acciones. Los dólares están calculados al techo de la franja de compra, que es lo que vas a pagar: el precio usado va escrito en la celda. Si ya la tenés, no aplica: dice cuánto pesa hoy, y cuánto sumar lo decide el plan, que no deja pasar una posición del 15% de la cartera." },
  riesgo: { label: "riesgo", short: "1 (tranquilo) a 10 (especulativo). Suma puntos por beta alta, rango diario amplio, deuda, poco volumen y capitalización chica. No es probabilidad de perder: dice cuánto te va a sacudir. No cambia el veredicto, cambia cuánto ponés." },
  etiquetas: { label: "etiquetas", short: "Clase de activo, sector y temas transversales. Editables; lo manual nunca se pisa." },
  fr3m: { label: "FR 3m", short: "Fuerza relativa contra SPY a 3 meses: cuánto le ganó (o perdió) al S&P 500." },
  fr6m: { label: "FR 6m", short: "Fuerza relativa contra SPY a 6 meses." },
  fr12m: { label: "FR 12m", short: "Fuerza relativa contra SPY a 12 meses." },
  fr3mMerval: { label: "FR 3m vs Merval", short: "Fuerza relativa contra el índice Merval a 3 meses, en pesos." },
  fr12mMerval: { label: "FR 12m vs Merval", short: "Fuerza relativa contra el índice Merval a 12 meses, en pesos." },
  sma200: { label: "vs SMA200", short: "Distancia al promedio móvil de 200 ruedas. Negativo = tendencia de fondo bajista, queda afuera." },
  adr: { label: "ADR", short: "El mismo papel cotizando en Nueva York, en dólares. Ahí están los fundamentals y el ranking contra pares." },
  frMerval: { label: "FR 6m vs Merval", short: "Fuerza relativa contra el índice Merval a 6 meses, en pesos: cuánto le ganó (o perdió) al mercado local. Para ser CANDIDATA tiene que ser > 0 y estar sobre la SMA200." },
  precioArs: { label: "precio ARS", short: "Último cierre en pesos en BYMA." },
  precioUsd: { label: "precio USD", short: "El mismo cierre pasado a dólares al CCL del día." },
  ratio: { label: "ratio", short: "Cuántos CEDEARs equivalen a una acción en EE.UU. Cambia con los splits: si el dólar implícito se va más de 10% del CCL, el ratio cargado está mal." },
  dolarImplicito: { label: "dólar implícito", short: "Precio del CEDEAR × ratio / precio en EE.UU.: el dólar que pagás comprando la acción vía CEDEAR." },
  vsCcl: { label: "vs CCL", short: "Dólar implícito contra el CCL. Más de +2% el CEDEAR está caro; menos de −2% está barato. Más de 10% en cualquier sentido: ratio dudoso, no oportunidad." },
  seguimiento: { label: "seguimiento", short: "Tickers que elegís vos. Reciben todos los días veredicto técnico, stop, objetivo, tamaño y riesgo, y su rank contra pares si están en el universo, aunque el ranking no los elija. Ideal para historias (energía para IA, minerales) que el filtro de valor deja afuera." },
  cantidad: { label: "cantidad", short: "Acciones o cuotas que compra el monto de la línea, redondeado hacia abajo, contadas al precio de la orden: el techo de la franja en una compra (lo máximo que pagás, así nunca gastás de más) y el precio de hoy en el núcleo y en un SUMAR. El precio usado va escrito al lado. Con tramos, debajo va la cantidad del primero." },
  comprarHasta: { label: "comprar hasta", short: "Precio máximo para entrar: el cierre más 2%. Si ya lo pasó, no lo corras; esperá al día siguiente. 'mercado' = se compra al precio que esté." },
  cuandoEntrar: { label: "cuándo entrar", short: "Si hoy es el día, y a qué precio. 'comprar ahora' con la franja de compra. 'esperar' con orden limitada en la media de 20 ruedas si está muy estirada. 'si cierra arriba de' el máximo de las últimas 10 ruedas si cayó bajo su media de 50: se compra al cierre si lo supera, no con una orden limitada, que se ejecutaría enseguida porque el nivel está arriba del precio. La condición vale las ruedas que dice; pasadas, se vuelve a evaluar. El núcleo va siempre a mercado. 'No por debajo de' es el piso de la orden: más abajo el stop queda a menos de 1 ATR, y se espera a la corrida siguiente." },
  stopPlan: { label: "stop", short: "Si cierra por debajo, se vende: la tesis se anuló. En una compra nueva queda al menos 2,5 ATR debajo del piso de la franja; en un SUMAR es el de tu posición. El % se mide desde el precio de la orden, el mismo de la cantidad y el objetivo. No tiene plazo." },
  objetivoPlan: { label: "objetivo", short: "Precio al que la operación paga 2 veces lo que arriesga hasta el stop, sin plazo. No es una ganancia esperada: es exactamente el doble de la distancia al stop, así que un papel tranquilo muestra 4% y uno volátil 20% sin que eso diga nada de cuál es mejor. Debajo va el retorno real de 12 meses con dividendos, que sí habla de la empresa." },
  alpha30: { label: "alpha 30d", short: "Se completa 30 días después del plan: cuánto le ganó o perdió la línea al S&P 500 en ese período, haya tocado o no el objetivo. Es la medición, no el objetivo." },
  alpha90: { label: "alpha 90d", short: "Lo mismo a 90 días." },
  conviccion: { label: "convicción", short: "score × fiabilidad del grupo (pares/10, tope 1) + 0.2 por consenso de compra, insiders que compran o sorpresa positiva − banderas negativas − 0.1 por punto de riesgo sobre 5 − 0.3 si el objetivo queda a menos de 5% − 0.3 si comparte un tema donde ya tenés más del 40% de la cartera − 0.3 si se mueve como algo que ya tenés − 0.3 si es sensible a tasas con régimen restrictivo. La verificación apta y el dividendo no suman: son buenas noticias sin puntaje. Con convicción negativa no entra al plan." },
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
        <p><b>Entrada</b>: la franja de compra, que sale del momento de entrada (en zona: del cierre hasta +2%). <b>Stop</b>: hay dos. El de seguimiento (máximo de 22 ruedas menos 3 ATR) decide si la tendencia sigue en pie: si el precio lo perfora, el candidato pasa a OBSERVAR. El de la orden, en una compra nueva, es el más bajo entre ese y el piso de la franja menos 2,5 ATR: hasta el 13/9 era el de seguimiento, y después de un retroceso quedaba pegado al precio (NVDA a 0,44 ATR, STNG a 0,00), así que el ruido de un día lo ejecutaba. Si ya tenés el papel, manda el stop de tu posición. <b>Objetivo</b>: el precio donde la operación paga 2 veces lo que arriesga hasta el stop, medido desde el techo de la franja. No es un pronóstico: al lado va el consenso de analistas, que sí es una opinión sobre la empresa.</p>

        <h3>Cómo se combinan para decidir si entrar</h3>
        <ol>
          <li><b>Los filtros son la puerta.</b> Una acción es CANDIDATA si pasó los filtros técnicos: por encima de la media de 200 ruedas, no subió más de 15% en 21 ruedas, no reporta en 10 días, no está bajo su stop, no es residente crónico (4ª semana seguida como candidato). OBSERVAR es "buena empresa, mal momento".</li>
          <li><b>Entre las candidatas, el plan elige por convicción</b>, solo con verificación web apta con el cuestionario vigente y la revisión antes de comprar sin objeciones; lo que compra dice COMPRAR, con su monto. El resto sigue como CANDIDATA con su motivo.</li>
          <li><b>El riesgo te dice cuánto y qué esperar.</b> Un 9/10 es una apuesta: respetá el tamaño de la tabla, no lo agrandes porque el score es lindo.</li>
          <li><b>Entrá dentro del rango de entrada.</b> Si el precio ya se escapó por arriba, no lo corras.</li>
          <li><b>Cruzalo con la concentración de Cartera.</b> Si ya tenés más del 40% en un tema, dos candidatos más de ese tema no suman diversificación. El plan del aporte hace este cruce solo: núcleo primero, 2 posiciones nuevas más una por cada tres aportes mensuales que tenga el monto (4 con 40.000, tope 5), la mitad del aporte como máximo por línea y ninguna posición por encima del 15% de la cartera.</li>
        </ol>

        <h3>Convicción: "lo que más recomienda hoy"</h3>
        <p>Junta todo lo anterior en un número, sin agregar nada nuevo: score × fiabilidad del grupo (pares/10, tope 1), +0.2 por consenso de compra, insiders que compran o sorpresa positiva, −0.15/−0.3 por banderas negativas, −0.1 por cada punto de riesgo sobre 5, −0.3 si el objetivo queda a menos de 5%, −0.3 si comparte un tema donde ya tenés más del 40% de la cartera, −0.3 si se mueve como algo que ya tenés y −0.3 si es sensible a tasas con el régimen restrictivo. La verificación apta y el dividendo no suman. "Todo acompaña" es cuando no hay ninguna salvedad. Con convicción negativa el plan no la compra aunque sea la única.</p>

        <h3>ETFs</h3>
        <p><b>FR 3m / 6m / 12m</b>: fuerza relativa contra SPY, cuánto le ganó o perdió al S&amp;P 500 en ese plazo. <b>vs SMA200</b>: distancia al promedio de 200 ruedas. Los de núcleo (NUCLEO) se compran por calendario según el plan; satélites y coberturas salen CANDIDATA u OBSERVAR por fuerza relativa; COMPRAR solo si el plan los compra.</p>

        <h3>Seguimiento</h3>
        <p>El Radar es un filtro de valor: las historias que ya están en el precio (energía para la IA, minerales críticos) rara vez entran como candidatas. La lista de seguimiento te deja seguirlas con las mismas reglas: veredicto técnico (CANDIDATA si está sobre la SMA200 y no corrió más de 15% en 21 ruedas; si no OBSERVAR con la razón; COMPRAR solo si el plan la toma como línea de seguimiento), stop chandelier, objetivo 2:1, tamaño y riesgo, más el rank contra pares cuando el papel está en el universo. El plan del aporte toma como máximo una de tu lista por mes (la de menor riesgo en COMPRAR); el resto queda como CANDIDATA: la decisión es tuya, el sistema te pone la disciplina.</p>

        <h3>Argentina</h3>
        <p>Las acciones de BYMA cotizan en pesos, así que se comparan contra el <b>Merval</b> y no contra SPY: CANDIDATA si le ganan al índice a 6 meses y están sobre la media de 200 ruedas. El plan en dólares no compra papeles argentinos, así que acá nunca dice COMPRAR. No tienen score ni rank porque Finnhub no cubre el mercado local; cuando el papel tiene <b>ADR</b>, los fundamentals están en la ficha del ADR. El <b>precio USD</b> es el cierre en pesos al CCL del día. Los <b>CEDEARs</b> no son una recomendación: son un chequeo de a qué dólar estás comprando la acción de EE.UU. si la comprás en pesos. El <b>macro</b> (CCL, MEP, oficial, brecha, riesgo país, Merval en dólares) se guarda todos los días para tener la serie.</p>

        <p className="muted"><b>Advertencia honesta:</b> el score todavía no está validado. La medición a 7, 30 y 90 días contra SPY, con OBSERVAR como grupo de control, es la que va a decir si estos números anticipan algo. Hasta entonces es un buen filtro para saber dónde mirar, no una promesa.</p>
      </div>
    </div>
  );
}
