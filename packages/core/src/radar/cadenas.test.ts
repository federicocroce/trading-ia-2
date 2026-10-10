import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CadenasSchema, nombreDelEslabon, simbolosDelEslabon } from "./cadenas.js";

const real = CadenasSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL("../../../../config/cadenas.json", import.meta.url)), "utf8")));

describe("cadenas (10/10)", () => {
  it("el config/cadenas.json real valida, y los ids de eslabón no se repiten", () => {
    const ids = real.cadenas.flatMap((c) => c.eslabones.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
    // Cada eslabón cuelga de su tema: "ia.memoria" está bajo "ia".
    for (const c of real.cadenas) for (const e of c.eslabones) expect(e.id.startsWith(`${c.id}.`)).toBe(true);
  });
  it("devuelve las acciones y el nombre de un eslabón; null si no existe", () => {
    expect(simbolosDelEslabon(real, "ia.memoria")).toEqual(["MU", "SNDK", "WDC", "STX"]);
    expect(nombreDelEslabon(real, "ia.memoria")).toBe("Inteligencia artificial → memoria");
    expect(simbolosDelEslabon(real, "ia.inventado")).toBeNull();
  });
  it("no trae los símbolos que la app no puede evaluar (sacados el 10/10)", () => {
    const todos = real.cadenas.flatMap((c) => c.eslabones.flatMap((e) => e.simbolos));
    for (const s of ["BG", "CRESY", "DNN", "LAC"]) expect(todos).not.toContain(s);
  });
});
