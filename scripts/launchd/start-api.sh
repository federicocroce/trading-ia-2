#!/bin/zsh
# Arranque de la API para launchd: node de nvm en el PATH, espera a Docker y a la base.
# Sin watch: un cambio de código no reinicia la API a mitad de una corrida (barrido, ponerse al día).
# Después de cambiar código: launchctl kickstart -k gui/$(id -u)/com.thesis-engine.api
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 120); do docker info >/dev/null 2>&1 && break; sleep 5; done
docker compose up -d db >/dev/null 2>&1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 3; done
# Si el proceso anterior todavía tiene el puerto (relanzamiento), esperar a que lo suelte en vez de morir con EADDRINUSE en loop.
for i in $(seq 1 30); do lsof -nP -iTCP:3002 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
exec pnpm --filter @thesis/api start
