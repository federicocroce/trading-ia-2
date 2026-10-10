import { describe, expect, it } from "vitest";
import { nasdaqEarningsCalendar } from "../src/earnings/index.js";
import type { HttpClient } from "../src/http/index.js";

/** Un Nasdaq falso: devuelve filas por fecha, y falla en los días que se le digan. */
const nasdaq = (porDia: Record<string, string[]>, fallan: string[] = []) => {
  const pedidos: string[] = [];
  const http = {
    getJson: async (url: string) => {
      const date = /date=(\d{4}-\d{2}-\d{2})/.exec(url)![1]!;
      pedidos.push(date);
      if (fallan.includes(date)) throw new Error("HTTP 403");
      return { data: { rows: (porDia[date] ?? []).map((symbol) => ({ symbol, name: symbol, time: "time-after-hours", epsForecast: "", noOfEsts: "", lastYearEPS: "", marketCap: "" })) } };
    },
  } as unknown as HttpClient;
  return { http, pedidos };
};

describe("nasdaqEarningsCalendar (10/10)", () => {
  it("cada símbolo con su fecha más próxima, sin pedir sábados ni domingos", async () => {
    // 10/10/2026 es sábado: el primer pedido es el lunes 12.
    const { http, pedidos } = nasdaq({ "2026-10-15": ["TSM"], "2026-10-22": ["NEM"], "2026-10-29": ["DXCM", "NEM"] });
    const r = await nasdaqEarningsCalendar(http, "2026-10-10", 20);
    expect(r.fechas.get("TSM")).toBe("2026-10-15");
    expect(r.fechas.get("NEM")).toBe("2026-10-22");
    expect(r.fechas.get("DXCM")).toBe("2026-10-29");
    expect(r.diasFallidos).toBe(0);
    expect(pedidos.some((d) => ["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"].includes(d))).toBe(false);
  });
  it("un día que falla no corta el resto, y se cuenta", async () => {
    const { http } = nasdaq({ "2026-10-29": ["DXCM"] }, ["2026-10-15"]);
    const r = await nasdaqEarningsCalendar(http, "2026-10-12", 20);
    expect(r.fechas.get("DXCM")).toBe("2026-10-29");
    expect(r.diasFallidos).toBe(1);
  });
});
