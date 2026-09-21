import { describe, expect, it } from "vitest";
import { estadoDeLider } from "./lider.js";

/*
 * 21/9: META subió 12,7% en un día por Muse y Connect, con Arm +13% e Intel +12% atrás. La app no la compraba antes ni
 * después: "no perseguir". Y "subió más de 100%" saca del plan a SNDK, SIMO, TER y MU. Los frenos cuidan de comprar techos,
 * pero la app decía "no" y nunca volvía con un "ahora sí". Medido ese día (7 días, 19 símbolos): lo que frenó "no perseguir"
 * rindió −0,41% contra −1,31% de lo que sí dejaba comprar. Aprobado por el dueño: una lista aparte que NO entra al plan y se
 * mide; si en unas semanas le gana al plan, se le abre lugar. La lista marca al líder frenado solo por haber subido, y
 * distingue al que hoy está en una zona donde entrar no es perseguir.
 */
const fila = (flags: string[], entry: string | null, over: { reasons?: string[]; target?: number | null } = {}) => ({ flags, reasons: over.reasons ?? [], entryState: entry, target: over.target === undefined ? 100 : over.target });

describe("estadoDeLider", () => {
  it("SIMO y TER el 21/9: subieron más de 100%, sorprendieron para arriba y están en zona → líder en retroceso", () => {
    expect(estadoDeLider(fila(["consenso_compra", "sorpresa_positiva", "sin_estados", "subio_mucho_12m"], "en_zona"))).toBe("en_retroceso");
    expect(estadoDeLider(fila(["insiders_venden", "consenso_compra", "sorpresa_positiva", "subio_mucho_12m"], "retroceso"))).toBe("en_retroceso");
    // PARR: además "consenso cerca", y por las dos juntas el Radar la tiene en OBSERVAR: las dos salen de haber subido.
    expect(estadoDeLider(fila(["consenso_compra", "sorpresa_positiva", "consenso_en_precio", "subio_mucho_12m", "salvedades_de_calidad"], "en_zona", { reasons: ["salvedades_de_calidad"] }))).toBe("en_retroceso");
  });
  it("SNDK y META el 21/9: extendidas → líder esperando su retroceso (META sin señal a favor cargada igual se muestra)", () => {
    expect(estadoDeLider(fila(["consenso_compra", "sorpresa_positiva", "subio_mucho_12m"], "esperar_retroceso"))).toBe("esperando");
    expect(estadoDeLider(fila(["no_perseguir", "residente_cronico", "evento_moderado", "verificacion_reservas", "stop_dentro_de_la_entrada"], "esperar_retroceso", { reasons: ["no_perseguir", "residente_cronico", "stop_dentro_de_la_entrada"], target: null }))).toBe("esperando");
    // BE: en zona por la media, pero subió más de 15% en 21 ruedas: todavía es perseguir.
    expect(estadoDeLider(fila(["no_perseguir", "consenso_en_precio", "subio_mucho_12m", "salvedades_de_calidad"], "en_zona", { reasons: ["no_perseguir", "salvedades_de_calidad"] }))).toBe("esperando");
  });
  it("en retroceso exige una señal a favor (guía subida o sorpresa positiva) y un boleto ejecutable; si no, espera", () => {
    expect(estadoDeLider(fila(["consenso_compra", "subio_mucho_12m"], "en_zona"))).toBe("esperando");
    expect(estadoDeLider(fila(["guia_subida", "subio_mucho_12m"], "en_zona"))).toBe("en_retroceso");
    expect(estadoDeLider(fila(["sorpresa_positiva", "subio_mucho_12m"], "en_zona", { target: null }))).toBe("esperando");
  });
  it("auditoría de la tarjeta (21/9): LRCX cerró bajo su media de 50 y espera un cierre 12% más arriba: eso no es un retroceso de un líder; y lo que ya tenés no va en esta lista", () => {
    expect(estadoDeLider(fila(["insiders_venden", "consenso_compra", "sorpresa_positiva", "subio_mucho_12m"], "esperar_confirmacion"))).toBeNull();
    // VIST: ya está en cartera y Cartera decide sobre ella; acá podría decir "en retroceso" mientras Cartera dice VENDER.
    expect(estadoDeLider({ ...fila(["consenso_compra", "sorpresa_positiva", "subio_mucho_12m"], "en_zona"), held: true })).toBeNull();
  });
  it("no es líder lo que no subió, lo que tiene algo en contra, ni lo que frena otra regla", () => {
    expect(estadoDeLider(fila(["consenso_compra", "sorpresa_positiva"], "en_zona"))).toBeNull();
    // AII, SLDE: "consenso cerca" solo no es liderazgo, es una aseguradora cerca de su objetivo.
    expect(estadoDeLider(fila(["sorpresa_positiva", "consenso_en_precio"], "en_zona"))).toBeNull();
    // ARIS y CGAU: subieron más de 100% pero decepcionaron. NUTX: tres salvedades de calidad de verdad.
    expect(estadoDeLider(fila(["consenso_compra", "sorpresa_negativa", "subio_mucho_12m"], "en_zona"))).toBeNull();
    expect(estadoDeLider(fila(["sorpresa_positiva", "interes_minoritario", "ganancia_sin_ventas", "subio_mucho_12m", "salvedades_de_calidad"], "en_zona", { reasons: ["salvedades_de_calidad"] }))).toBeNull();
    // LQDA: bajo su stop. MU: resultados en días. SMCI-like: investigación abierta.
    expect(estadoDeLider(fila(["consenso_compra", "subio_mucho_12m", "bajo_stop"], "esperar_confirmacion", { reasons: ["bajo_stop"] }))).toBeNull();
    expect(estadoDeLider(fila(["sorpresa_positiva", "resultados_cerca", "subio_mucho_12m"], "en_zona", { reasons: ["resultados_cerca"] }))).toBeNull();
    expect(estadoDeLider(fila(["sorpresa_positiva", "subio_mucho_12m", "investigacion_abierta"], "en_zona"))).toBeNull();
  });
});
