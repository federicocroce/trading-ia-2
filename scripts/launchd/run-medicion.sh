#!/bin/zsh
# Medición mensual de los frenos (23/9): el día 12 de cada mes a las 09:00 deja escrito, en docs/mediciones/,
# qué pasó con lo que cada freno dejó afuera contra lo que ningún freno tocó, a 7, 30 y 90 días.
#
# Por qué el 12. El Radar arrancó el 7/9/2026 y el verificador recién dictaminó desde el 10/9, así que la primera
# fecha con alfa a 30 días para filas verificadas es el 10/10: el 12 da margen. La pregunta que tiene que contestar
# esa primera corrida es si "verificación web apta" discrimina algo — al 23/9, con 12 símbolos y solo 7 días,
# rendía 0,85 puntos PEOR que lo que ningún freno tocó, y el 82% de los dictámenes eran "con reservas".
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 5; done
docker compose up -d db >/dev/null 2>&1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 5; done

hoy="$(date '+%F')"
mkdir -p docs/mediciones
salida="docs/mediciones/$hoy.md"
{
  echo "# Medición de los frenos — $hoy"
  echo
  echo "Generada sola por com.thesis-engine.medicion. Solo lectura: no toca el Radar ni el plan."
  echo
  for h in 7 30 90; do
    echo "## Alfa a $h días"
    echo
    echo '```'
    pnpm -s frenos "$h" 2>&1
    echo '```'
    echo
  done
  echo "## Cómo se lee"
  echo
  echo "Un freno se gana el lugar si lo que deja afuera rinde PEOR que lo que ningún freno tocó (puntos negativos)."
  echo "Un freno con puntos positivos está sacando del plan cosas que habrían andado bien."
  echo "Con pocos símbolos es ruido y la propia salida lo dice."
} > "$salida"
echo "[medicion] $(date '+%F %T') escrito $salida"
osascript -e "display notification \"Está en $salida\" with title \"Radar: medición mensual de los frenos\" sound name \"Submarine\"" >/dev/null 2>&1
