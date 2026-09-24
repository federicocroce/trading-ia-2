#!/bin/zsh
# Instala solo la guardia de la mañana (23/9): lunes a viernes 09:00, después del refresco (07:50) y del agente
# de verificación (08:15), y hora y media antes de que abra el mercado, para que haya tiempo de arreglar lo que
# avise (24/9: a las 10:00 llegaba 30 minutos antes de la apertura, sin margen). No toca la API, el web ni los
# otros agentes. Correr desde el repo principal.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$HOME/Library/Logs/thesis-engine"; mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
chmod +x "$ROOT/scripts/launchd/run-guardia.sh"
PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.guardia.plist"
DIAS=""
for d in 1 2 3 4 5; do DIAS="$DIAS<dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>"; done
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.guardia</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/run-guardia.sh</string></array>
  <key>StartCalendarInterval</key><array>$DIAS</array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/guardia.log</string>
  <key>StandardErrorPath</key><string>$LOGS/guardia.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.thesis-engine.guardia" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "instalado com.thesis-engine.guardia (lunes a viernes 09:00, log en $LOGS/guardia.log)"
