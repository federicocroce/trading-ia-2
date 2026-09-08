import { describe, expect, it } from "vitest";
import { resolveWatchStatus } from "./watch-lifecycle.js";

describe("resolveWatchStatus (ciclo de vida del seguimiento, portado de v1)", () => {
  const base = { entryPrice: 100, targetPrice: 120, stopLoss: 92, currentPrice: 105, daysSince: 5, horizonDays: 30 };
  it("viva mientras no toque stop ni objetivo ni venza el plazo; retorno desde el alta", () => {
    expect(resolveWatchStatus(base)).toEqual({ status: "live", returnPct: 5, hitTarget: false, hitStop: false });
  });
  it("gatillada al tocar el objetivo, invalidada al tocar el stop (el stop gana si tocó los dos)", () => {
    expect(resolveWatchStatus({ ...base, currentPrice: 121 }).status).toBe("triggered");
    expect(resolveWatchStatus({ ...base, currentPrice: 91 }).status).toBe("invalidated");
    expect(resolveWatchStatus({ ...base, targetPrice: 90, stopLoss: 92, currentPrice: 90 }).status).toBe("invalidated");
  });
  it("expirada al cumplir el plazo sin resolverse; sin stop ni objetivo solo puede vivir o expirar", () => {
    expect(resolveWatchStatus({ ...base, daysSince: 30 }).status).toBe("expired");
    expect(resolveWatchStatus({ ...base, targetPrice: null, stopLoss: null, currentPrice: 150, daysSince: 3 }).status).toBe("live");
    expect(resolveWatchStatus({ ...base, targetPrice: null, stopLoss: null, currentPrice: 150, daysSince: 45 })).toMatchObject({ status: "expired", returnPct: 50 });
  });
  it("sin precio de alta no hay retorno", () => {
    expect(resolveWatchStatus({ ...base, entryPrice: 0 }).returnPct).toBe(0);
  });
});
