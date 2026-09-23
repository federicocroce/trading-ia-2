#!/bin/zsh
# La guardia de la mañana (23/9): mira si la corrida de hoy salió bien y, solo si algo anda mal, lo grita con una
# notificación del sistema. Calla cuando todo está en orden: una guardia que avisa todos los días se ignora.
# Corre 10:00 de lunes a viernes, después del refresco (07:50) y del agente de verificación (08:15, espera hasta 3 h).
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 5; done
docker compose up -d db >/dev/null 2>&1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 5; done

echo "[guardia] $(date '+%F %T') arranca"
salida="$(pnpm -s guardia 2>&1)"
rc=$?
echo "$salida"
echo "[guardia] $(date '+%F %T') termina con código $rc"
[ $rc -eq 0 ] && exit 0

# Un aviso por línea, sin comillas que rompan el osascript. Si la guardia ni siquiera pudo correr (base caída,
# API rota), rc también es distinto de 0 y el mensaje lo dice: que falle en silencio sería lo peor de todo.
motivos="$(printf '%s\n' "$salida" | sed -n 's/^\[guardia\] //p' | tr -d '"' | head -4 | tr '\n' ' ')"
[ -z "$motivos" ] && motivos="la guardia no pudo correr (mirá el log)"
osascript -e "display notification \"$motivos\" with title \"Radar: revisá antes de comprar\" sound name \"Submarine\"" >/dev/null 2>&1
exit $rc
