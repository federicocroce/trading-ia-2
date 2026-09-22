#!/bin/zsh
# Corre la skill /verificar sin nadie en la terminal (lunes a viernes 08:15). Espera a que el Radar del día esté refrescado
# (hasta 3 horas: el 22/9 un corte de luz dejó el refresco para las 09:51). El agente sólo puede usar el CLI del Radar,
# búsqueda y lectura web, agentes y escribir en docs/verificaciones.
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 120); do docker info >/dev/null 2>&1 && break; sleep 5; done
docker compose up -d db >/dev/null 2>&1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 5; done
HOY="$(date +%F)"
for i in $(seq 1 180); do
  [ "$(docker exec thesis-db psql -U thesis -d thesis -Atc "select last_date from job_runs where step='radar'" 2>/dev/null)" = "$HOY" ] && break
  [ "$i" = 1 ] && echo "[verificar] $(date '+%F %T') esperando el refresco del Radar de hoy"
  sleep 60
done
if [ "$(docker exec thesis-db psql -U thesis -d thesis -Atc "select last_date from job_runs where step='radar'" 2>/dev/null)" != "$HOY" ]; then
  echo "[verificar] $(date '+%F %T') sin refresco del Radar de hoy después de 3 horas: no corre"
  exit 1
fi
echo "[verificar] $(date '+%F %T') arranca"
claude -p "/verificar" \
  --allowedTools "Bash(pnpm --filter @thesis/api exec tsx src/radar-cli.ts *),Bash(cat *),Bash(ls *),Bash(mkdir *),Bash(export *),Bash(. *),Bash(source *),Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Agent" \
  --permission-mode acceptEdits \
  --max-turns 200
echo "[verificar] $(date '+%F %T') termina con código $?"
