# Verificaciones del agente

Cada día hábil, después del refresco del Radar, el agente de Claude Code corre `/verificar` (launchd, 08:15, ver
`scripts/launchd/run-verificar.sh`). Deja acá:

- `pendientes.json`: lo que la app le pidió verificar y revisar (se pisa cada día).
- `<fecha>.json`: los hallazgos del agente, con fuente, tal como los importó la app.
- `<fecha>.md`: el resumen de la corrida y su costo.

La regla que convierte hallazgos en dictamen está en `packages/reasoner/src/agente.ts`; el diseño, en
`docs/superpowers/specs/2026-09-22-verificacion-por-agente-design.md`.
