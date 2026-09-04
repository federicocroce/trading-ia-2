import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DEFAULT_RISK_LIMITS } from "@thesis/core";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, paper: true, limits: DEFAULT_RISK_LIMITS }));

const port = Number(process.env["PORT"] ?? 3001);
serve({ fetch: app.fetch, port }, () => {
  console.log(`thesis-engine api on :${port} (paper only)`);
});
