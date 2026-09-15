#!/bin/sh
# Verificación obligatoria antes de mergear (15/9): tests y tipos de TODOS los paquetes, sin cortarse en el
# primero que falla. El 14/9 `pnpm -r typecheck` se cortó en core y tres errores de pipeline quedaron ocultos
# detrás de un verde que no había corrido entero. El resumen dice qué corrió, para que un verde signifique algo.
set -u
fallos=""

echo "[verificar] tests"
if pnpm exec vitest run; then :; else fallos="$fallos tests"; fi

echo "[verificar] tipos de todos los paquetes"
if pnpm -r --no-bail typecheck; then :; else fallos="$fallos tipos"; fi

if [ -n "$fallos" ]; then
  echo "[verificar] FALLÓ:$fallos. No se mergea."
  exit 1
fi
echo "[verificar] ok: tests y tipos de todos los paquetes"
