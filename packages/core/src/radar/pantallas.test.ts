import { describe, expect, it } from "vitest";
import { checkPantallas, type Pantallas } from "../index.js";

const base: Pantallas = { candidatos: [], plan: null, veredictos: [] };
const cand = (symbol: string, over: Partial<Pantallas["candidatos"][number]> = {}) =>
  ({ symbol, verdict: "COMPRAR", close: 100, stop: 92, flags: [], entry: { state: "en_zona", low: 100, high: 102 }, ...over });
const linea = (symbol: string, over: Record<string, unknown> = {}) =>
  ({ symbol, kind: "comprar", close: 100, stop: 92, entry: { state: "en_zona" }, ...over }) as Pantallas["plan"] extends null ? never : NonNullable<Pantallas["plan"]>["lines"][number];
const solo = (check: string, f: ReturnType<typeof checkPantallas>) => f.filter((x) => x.check === check);

describe("checkPantallas", () => {
  it("una app coherente no reporta nada", () => {
    const f = checkPantallas({ ...base, candidatos: [cand("NVDA")], plan: { lines: [linea("NVDA")] }, veredictos: [{ symbol: "NVDA", verb: "MANTENER", close: 100, stop: 92 }] });
    expect(f).toEqual([]);
  });

  it("el caso que pidió el dueño: compra en una pantalla y venta en otra", () => {
    const f = solo("compra_y_venta", checkPantallas({ ...base, candidatos: [cand("PAM")], veredictos: [{ symbol: "PAM", verb: "VENDER", close: 100, stop: 92 }] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("Cartera propone sumar algo que el Radar tiene en OBSERVAR", () => {
    const f = solo("sumar_y_observar", checkPantallas({ ...base, candidatos: [cand("HUT", { verdict: "OBSERVAR" })], veredictos: [{ symbol: "HUT", verb: "SUMAR", close: 100, stop: 92 }] }));
    expect(f).toHaveLength(1);
  });

  it("dos precios distintos para el mismo símbolo el mismo día", () => {
    const f = solo("precio_distinto", checkPantallas({ ...base, candidatos: [cand("APH", { close: 83.92 })], veredictos: [{ symbol: "APH", verb: "MANTENER", close: 80.25, stop: 78 }] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("83.92");
  });

  it("dos stops distintos son dos órdenes distintas", () => {
    const f = solo("stop_distinto", checkPantallas({ ...base, candidatos: [cand("NBN", { stop: 127.72 })], plan: { lines: [linea("NBN", { stop: 130.5 })] } }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  describe("dos objetivos para la misma compra (TSM, 13/9)", () => {
    // El Radar decía 498,44 y la línea SUMAR del plan 472,46: el plan tomaba el stop del Radar y el objetivo de Cartera.
    const radar = cand("TSM", { close: 433.24, stop: 413.63, target: 498.44 });
    it("plan contra Radar", () => {
      const f = solo("objetivo_distinto", checkPantallas({ ...base, candidatos: [radar], plan: { lines: [linea("TSM", { kind: "sumar", close: 433.24, stop: 413.63, target: 472.46 })] } }));
      expect(f).toHaveLength(1);
      expect(f[0]!.severity).toBe("grave");
      expect(f[0]!.detail).toContain("472.46");
    });
    it("SUMAR de Cartera contra Radar; MANTENER no es una compra y no se compara", () => {
      const sumar = solo("objetivo_distinto", checkPantallas({ ...base, candidatos: [radar], veredictos: [{ symbol: "TSM", verb: "SUMAR", close: 433.24, stop: 413.63, target: 472.46 }] }));
      expect(sumar).toHaveLength(1);
      const mantener = solo("objetivo_distinto", checkPantallas({ ...base, candidatos: [radar], veredictos: [{ symbol: "TSM", verb: "MANTENER", close: 433.24, stop: 413.63, target: 472.46 }] }));
      expect(mantener).toEqual([]);
    });
    it("iguales, no se reporta", () => {
      const f = solo("objetivo_distinto", checkPantallas({ ...base, candidatos: [radar], plan: { lines: [linea("TSM", { kind: "sumar", close: 433.24, stop: 413.63, target: 498.44 })] }, veredictos: [{ symbol: "TSM", verb: "SUMAR", close: 433.24, stop: 413.63, target: 498.44 }] }));
      expect(f).toEqual([]);
    });
  });

  it("NVDA del 13/9: la tarjeta decía 2 a 1 al lado de +9,1% contra −1,6%", () => {
    const top = [{ symbol: "NVDA", gainPct: 9.1209, lossPct: -1.5576, reasons: ["objetivo +9.1% contra stop -1.6% (2 a 1)"] }];
    const f = solo("dos_a_uno_falso", checkPantallas({ ...base, top }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    const bien = [{ symbol: "NVDA", gainPct: 6.98, lossPct: -3.49, reasons: ["objetivo +7.0% contra stop -3.5% desde 222.66 (2 a 1)"] }];
    expect(solo("dos_a_uno_falso", checkPantallas({ ...base, top: bien }))).toEqual([]);
  });

  it("14/9: el plan es la única fuente de COMPRAR y no puede quedar atrás del Radar", () => {
    // El 13/9 a la noche entraron ORRF y HSBC al Radar y el plan seguía siendo el de las 16:37.
    const atrasado = solo("plan_atrasado", checkPantallas({ ...base, candidatos: [cand("ORRF", { candidateDate: "2026-09-14" })], plan: { builtAt: "2026-09-13T19:37:09Z", lines: [] } }));
    expect(atrasado).toHaveLength(1);
    expect(atrasado[0]!.severity).toBe("grave");
    const alDia = solo("plan_atrasado", checkPantallas({ ...base, candidatos: [cand("ORRF", { candidateDate: "2026-09-14" })], plan: { builtAt: "2026-09-14T10:52:00Z", lines: [] } }));
    expect(alDia).toEqual([]);
    // Una fila argentina más nueva no cuenta: esa corrida no rearma el plan en dólares.
    const argentina = solo("plan_atrasado", checkPantallas({ ...base, candidatos: [cand("GGAL.BA", { candidateDate: "2026-09-15", kind: "ar" })], plan: { builtAt: "2026-09-14T10:52:00Z", lines: [] } }));
    expect(argentina).toEqual([]);
  });

  it("APH el 14/9: el gráfico diario terminaba el 11/9 y el intradiario ya tenía la sesión del 14 (−5,8%)", () => {
    const f = solo("grafico_sin_ultima_rueda", checkPantallas({ ...base, graficos: [
      { symbol: "APH", ultimaDiaria: "2026-09-11", ultimaIntradiaria: "2026-09-14" },
      { symbol: "NVDA", ultimaDiaria: "2026-09-14", ultimaIntradiaria: "2026-09-14" },
      // Sin intradiario (Yahoo no respondió) no hay con qué comparar: no se inventa un error.
      { symbol: "GFI", ultimaDiaria: "2026-09-11", ultimaIntradiaria: null },
    ] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.symbol).toBe("APH");
    expect(f[0]!.severity).toBe("grave");
  });

  it("el plan compra algo que el Radar no tiene en COMPRAR", () => {
    const f = solo("plan_contra_radar", checkPantallas({ ...base, candidatos: [cand("DVA", { verdict: "OBSERVAR" })], plan: { lines: [linea("DVA")] } }));
    expect(f).toHaveLength(1);
  });

  it("el plan compra algo que ni aparece en los candidatos", () => {
    const f = solo("plan_sin_candidato", checkPantallas({ ...base, plan: { lines: [linea("BLBD")] } }));
    expect(f).toHaveLength(1);
  });

  it("el núcleo no necesita estar entre los candidatos", () => {
    const f = checkPantallas({ ...base, plan: { lines: [linea("VTI", { kind: "nucleo", stop: null, entry: null })] } });
    expect(f).toEqual([]);
  });

  it("el plan y la ficha no pueden dar instrucciones distintas de cuándo entrar", () => {
    const f = solo("entrada_distinta", checkPantallas({ ...base, candidatos: [cand("META", { entry: { state: "esperar_retroceso", low: 580, high: 586 } })], plan: { lines: [linea("META", { entry: { state: "en_zona" } })] } }));
    expect(f).toHaveLength(1);
  });

  it("V del 12/9: el objetivo no puede quedar debajo del precio que la misma línea manda pagar", () => {
    const f = solo("objetivo_bajo_la_entrada", checkPantallas({
      ...base, candidatos: [cand("V")],
      plan: { lines: [linea("V", { entryHigh: 377.86, target: 375.05, stop: 368.15 })] },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("nace perdida");
  });

  it("una línea sana, con el objetivo arriba de la entrada, no se reporta", () => {
    const f = solo("objetivo_bajo_la_entrada", checkPantallas({
      ...base, candidatos: [cand("NBN")],
      plan: { lines: [linea("NBN", { entryHigh: 135.29, target: 150.43, stop: 127.72 })] },
    }));
    expect(f).toEqual([]);
  });

  it("TSM del 12/9: un símbolo no puede recibir plata dos veces en el mismo plan", () => {
    const f = solo("simbolo_duplicado", checkPantallas({
      ...base, candidatos: [cand("TSM")],
      plan: { lines: [linea("TSM", { kind: "sumar" }), linea("TSM", { kind: "comprar" })] },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("no se puede estar comprado y excluido a la vez", () => {
    const f = solo("comprado_y_excluido", checkPantallas({ ...base, candidatos: [cand("LNC")], plan: { lines: [linea("LNC")], leftOut: [{ symbol: "LNC", reason: "tope de nuevas" }] } }));
    expect(f).toHaveLength(1);
  });

  it("Hoy no puede anunciar un cambio que el Radar no muestra", () => {
    const f = solo("novedad_desfasada", checkPantallas({ ...base, candidatos: [cand("GLW", { verdict: "COMPRAR" })], novedades: { verdictChanges: [{ symbol: "GLW", from: "COMPRAR", to: "OBSERVAR" }] } }));
    expect(f).toHaveLength(1);
  });

  /**
   * GGAL, caso real del 13/9 y la razón por la que este chequeo se reescribió. El 18/4/2026 se traspasaron
   * siete posiciones enteras de Buenbit a Nexo. Ese TRANSFER es la FOTO de lo que ya se tenía, así que las
   * compras de 2025 que aparecen antes YA ESTÁN adentro: sumarlas da 1.830 acciones cuando hay 920,77.
   *
   * La primera versión del chequeo hacía justo eso al revés (sumaba compras y dividendos ignorando el
   * traspaso) y reportaba 11,65 acciones "sin explicación" que estaban perfectamente explicadas. Lo detecté
   * corriendo la auditoría contra la base, no en un test: el test pasaba porque codificaba mi suposición.
   */
  it("un traspaso es una foto: lo anterior ya está adentro y no se suma dos veces", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "GGAL", quantity: 920.77279309 }],
      movimientos: [
        { symbol: "GGAL", type: "BUY", quantity: 42.0487106, date: "2025-07-17" },
        { symbol: "GGAL", type: "BUY", quantity: 859.22772136, date: "2025-10-07" },
        { symbol: "GGAL", type: "DIVIDEND", quantity: 7.84498722, date: "2026-01-22" },
        { symbol: "GGAL", type: "TRANSFER", quantity: 920.77279309, date: "2026-04-18" },
      ],
    }));
    expect(f).toEqual([]);
  });

  it("después del traspaso sí suma: una compra posterior tiene que verse en la posición", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "GGAL", quantity: 920.77279309 }],
      movimientos: [
        { symbol: "GGAL", type: "TRANSFER", quantity: 920.77279309, date: "2026-04-18" },
        { symbol: "GGAL", type: "BUY", quantity: 100, date: "2026-05-02" },
      ],
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("traspaso del 2026-04-18");
  });

  it("NEM sin traspaso: se suma todo desde el principio", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "NEM", quantity: 44.49726912 }],
      movimientos: [{ symbol: "NEM", type: "BUY", quantity: 44.49726912, date: "2026-06-10" }],
    }));
    expect(f).toEqual([]);
  });

  it("una venta resta, y la diferencia real se reporta", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "TSM", quantity: 20 }],
      movimientos: [
        { symbol: "TSM", type: "BUY", quantity: 10, date: "2026-01-05" },
        { symbol: "TSM", type: "SELL", quantity: 2, date: "2026-02-05" },
      ],
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("12");
  });

  it("un símbolo sin ningún movimiento cargado no se reporta: es una carga pendiente, no una contradicción", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "NEM", quantity: 100 }],
      movimientos: [{ symbol: "TSM", type: "BUY", quantity: 10, date: "2026-01-05" }],
    }));
    expect(f).toEqual([]);
  });
});

describe("plan atrasado con la fecha local (auditoría del 15/9)", () => {
  it("un plan armado el 15/9 a las 22:30 de Argentina (16/9 en UTC) no es 'del 16' ni se compara como tal", () => {
    const armado = new Date(2026, 8, 15, 22, 30).toISOString();
    // Radar del 15: el plan del 15 a la noche está al día (en UTC ya es 16 y parecía "adelantado"; al revés, un Radar
    // del 16 contra el plan del 15 a la noche tiene que decir que el plan es del 15).
    expect(solo("plan_atrasado", checkPantallas({ ...base, plan: { builtAt: armado, lines: [] }, candidatos: [cand("X", { candidateDate: "2026-09-15" })] }))).toEqual([]);
    const f = solo("plan_atrasado", checkPantallas({ ...base, plan: { builtAt: armado, lines: [] }, candidatos: [cand("X", { candidateDate: "2026-09-16" })] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toMatch(/se armó el 2026-09-15/);
  });
});
