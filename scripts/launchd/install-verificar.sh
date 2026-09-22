#!/bin/zsh
# Instala solo el agente de verificación (22/9): lunes a viernes 08:15, después del refresco de las 07:50. No toca la API
# ni el web (install.sh los reinicia). El script espera a que el Radar del día esté refrescado, hasta 3 horas.
# Correr desde el repo principal: el plist apunta al directorio de este script.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$HOME/Library/Logs/thesis-engine"; mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
chmod +x "$ROOT/scripts/launchd/run-verificar.sh"
PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.verificar.plist"
DIAS=""
for d in 1 2 3 4 5; do DIAS="$DIAS<dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>8</integer><key>Minute</key><integer>15</integer></dict>"; done
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.verificar</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/run-verificar.sh</string></array>
  <key>StartCalendarInterval</key><array>$DIAS</array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/verificar.log</string>
  <key>StandardErrorPath</key><string>$LOGS/verificar.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.thesis-engine.verificar" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "instalado com.thesis-engine.verificar (lunes a viernes 08:15, log en $LOGS/verificar.log)"

