#!/bin/zsh
# Corre la skill /hechos sin nadie en la terminal (sábados 09:00, antes del ranking del domingo). El agente sólo puede
# usar el CLI del Radar, búsqueda y lectura web, agentes y escribir en docs/hechos: nada más está permitido.
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 5; done
echo "[hechos] $(date '+%F %T') arranca"
claude -p "/hechos" \
  --allowedTools "Bash(pnpm --filter @thesis/api exec tsx src/radar-cli.ts *),Bash(cat *),Bash(ls *),Bash(mkdir *),Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Agent" \
  --permission-mode acceptEdits \
  --max-turns 200
echo "[hechos] $(date '+%F %T') termina con código $?"
