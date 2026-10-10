#!/bin/zsh
# Corre la skill /cadenas sin nadie en la terminal (lunes a viernes 07:00, antes del refresco de las 07:50, para que
# los hechos del día entren en ese refresco). Igual que /hechos: CLI del Radar, búsqueda y lectura web, agentes y
# escribir en docs/cadenas. La base la toca solo el importador.
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 120); do docker info >/dev/null 2>&1 && break; sleep 5; done
docker compose up -d db >/dev/null 2>&1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 5; done
mkdir -p docs/cadenas
echo "[cadenas] $(date '+%F %T') arranca"
claude -p "/cadenas" \
  --allowedTools "Bash(pnpm --filter @thesis/api exec tsx src/radar-cli.ts *),Bash(cat *),Bash(ls *),Bash(mkdir *),Bash(export *),Bash(. *),Bash(source *),Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Agent" \
  --permission-mode acceptEdits \
  --max-turns 150
rc=$?
echo "[cadenas] $(date '+%F %T') termina con código $rc"
