#!/bin/zsh
# Instala solo el agente de cadenas (10/10): lunes a viernes 07:00, antes del refresco de las 07:50. No toca la API ni el web (install.sh los reinicia).
# Correr desde el repo principal: el plist apunta al directorio de este script.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$HOME/Library/Logs/thesis-engine"; mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
chmod +x "$ROOT/scripts/launchd/run-cadenas.sh"
PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.cadenas.plist"
DIAS=""
for d in 1 2 3 4 5; do DIAS="$DIAS<dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>"; done
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.cadenas</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/run-cadenas.sh</string></array>
  <key>StartCalendarInterval</key><array>$DIAS</array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/cadenas.log</string>
  <key>StandardErrorPath</key><string>$LOGS/cadenas.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.thesis-engine.cadenas" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "instalado com.thesis-engine.cadenas (lunes a viernes 07:00, log en $LOGS/cadenas.log)"

