import { describe, expect, it } from "vitest";
import { horaDelPaso, textoDelBoton } from "./corridasTextos";

/**
 * Corridas, auditoría del 15/9: `job_runs` quedó viejo hasta ese día, así que cinco de los seis pasos tomaban la fecha
 * de la base y mostraban "—" como hora, que se lee como "no corrió". Y el botón del encabezado decía "última corrida
 * 15/09 10:24", que era la hora de la tesis, como si fuera la de todo el pipeline.
 */
describe("horaDelPaso", () => {
  it("fecha de la base sin hora: lo dice, no muestra un guion", () => {
    expect(horaDelPaso({ ranAt: null, ranAtSource: "base", lastDate: "2026-09-15" })).toBe("según la base, hora desconocida");
  });
  it("la hora que sí guarda la base (el plan, cuándo se armó) se muestra en hora de Argentina y dice de dónde sale", () => {
    expect(horaDelPaso({ ranAt: "2026-09-15T18:56:51.462Z", ranAtSource: "base", lastDate: "2026-09" })).toBe("15/09 15:56 (según la base)");
  });
  it("la del registro de corridas va sola; sin nada, no corrió nunca", () => {
    expect(horaDelPaso({ ranAt: "2026-09-15T13:24:37.142Z", ranAtSource: "registro", lastDate: "2026-09-15" })).toBe("15/09 10:24");
    expect(horaDelPaso({ ranAt: null, ranAtSource: null, lastDate: null })).toBe("nunca corrió");
  });
});

describe("textoDelBoton", () => {
  const paso = (id: string, label: string, o: { ranAt?: string | null; due?: boolean } = {}) => ({ id, label, ranAt: o.ranAt ?? null, due: o.due ?? false });
  it("el 15/9: seis pasos al día y la hora conocida más nueva con el nombre de su paso, no como la de todo", () => {
    const st = { running: false, current: null, lastRunAt: "2026-09-15T13:24:37.142Z", lastRunStep: "tesis", steps: [paso("scan", "Barrido y ranking del universo"), paso("cartera", "Veredictos de Cartera"), paso("radar", "Refresco y medición del Radar"), paso("argentina", "Argentina (macro, BYMA, CEDEARs)"), paso("plan", "Plan del aporte"), paso("tesis", "Tesis por eventos", { ranAt: "2026-09-15T13:24:37.142Z" })] };
    expect(textoDelBoton(st)).toBe("6 de 6 pasos al día · Tesis por eventos 15/09 10:24");
  });
  it("con pendientes lo cuenta; corriendo, dice qué paso", () => {
    const st = { running: false, current: null, lastRunAt: null, lastRunStep: null, steps: [paso("scan", "Barrido", { due: true }), paso("tesis", "Tesis")] };
    expect(textoDelBoton(st)).toBe("1 de 2 pasos al día");
    expect(textoDelBoton({ ...st, running: true, current: "scan" })).toBe("corriendo Barrido…");
  });
});
