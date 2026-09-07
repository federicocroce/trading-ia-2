import { Hono } from "hono";
import { z } from "zod";
import { AssetClassSchema, type Tags } from "@thesis/core";
import type { Container } from "../container.js";

/** Etiquetas por ticker (spec etapa 2 §5): lectura, opciones y edición manual (que nunca se pisa). */
const Body = z.object({ assetClass: AssetClassSchema.optional(), sector: z.string().min(1).optional(), themes: z.array(z.string()).optional() }).strict();

export function taxonomyRoutes(c: Container) {
  const app = new Hono();
  const { store, taxonomy } = c.radarDeps;
  app.get("/taxonomy/options", (ctx) =>
    ctx.json({ assetClasses: AssetClassSchema.options, sectors: taxonomy.sectors, themes: taxonomy.themes, exposures: ["rv_us", "rv_internacional", "emergentes", "sector", "commodity", "bonos", "cripto", "argentina"], roles: ["nucleo", "satelite", "cobertura"] }),
  );
  app.get("/taxonomy/:symbol", async (ctx) => {
    const t = await store.tags(ctx.req.param("symbol").toUpperCase());
    return t ? ctx.json(t) : ctx.json({ error: "sin etiquetas" }, 404);
  });
  app.put("/taxonomy/:symbol", async (ctx) => {
    const p = Body.safeParse(await ctx.req.json().catch(() => ({})));
    if (!p.success) return ctx.json({ error: p.error.flatten() }, 400);
    const symbol = ctx.req.param("symbol").toUpperCase();
    const current = await store.tags(symbol);
    if (!current && !p.data.assetClass) return ctx.json({ error: "assetClass requerido para un símbolo sin etiquetas" }, 400);
    if (p.data.sector && !taxonomy.sectors.includes(p.data.sector)) return ctx.json({ error: `sector desconocido: ${p.data.sector}` }, 400);
    const tags: Tags = {
      assetClass: p.data.assetClass ?? current!.assetClass,
      sector: p.data.sector ?? current?.sector ?? "Otros",
      industry: current?.industry ?? null,
      themes: [...new Set(p.data.themes ?? current?.themes ?? [])].filter((t) => taxonomy.themes.includes(t)),
      themesSource: "manual",
    };
    await store.saveTags(symbol, tags);
    return ctx.json(tags);
  });
  return app;
}
