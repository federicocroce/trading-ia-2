import { describe, expect, it } from "vitest";
import { calibrationReport } from "../src/calibration.js";

/**
 * Hallazgo de la auditoría de pantallas del 2026-09-12 sobre Calibración.
 *
 * Con cero tesis cerradas la pantalla mostraba "0% tasa de acierto", "0% drawdown máx" y, peor, certificaba
 * el criterio "Drawdown máx < 15%" como CUMPLE, en verde. Cero no es un resultado: es la ausencia de datos.
 * Dos de los cuatro criterios ya exigían muestras y el de drawdown no, dentro de la misma función.
 */
describe("calibrationReport sin tesis cerradas", () => {
  const r = calibrationReport([], 100_000);

  it("ningún criterio se da por cumplido sin muestras", () => {
    expect(r.criteria.enoughSamples).toBe(false);
    expect(r.criteria.calibratesBetterThanMarket).toBe(false);
    expect(r.criteria.positiveExpectancy).toBe(false);
    // Este era el que fallaba: 0 < 15 daba true y la pantalla lo mostraba como cumplido.
    expect(r.criteria.drawdownOk).toBe(false);
    expect(r.criteria.readyForRealMoney).toBe(false);
  });

  it("informa cero tesis cerradas, que es lo que la pantalla tiene que usar para no mostrar números", () => {
    expect(r.closed).toBe(0);
  });
});
