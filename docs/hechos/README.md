# Hechos externos

Cada corrida de `/hechos` deja acá `<fecha>.json` (lo que entró al importador) y `<fecha>.md` (qué entró, qué se rechazó y cuánto costó). El importador es `radar-cli.ts hechos --importar`, el único camino de escritura a `hechos_externos`. Solo lo verificado (fuente primaria, ver `config/hechos-fuentes.json`) produce banderas en el Radar.
