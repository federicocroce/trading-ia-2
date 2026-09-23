#!/bin/zsh
# Instala solo la medición mensual de los frenos (23/9): día 12 de cada mes, 09:00. La primera cae el 12/10/2026,
# que es la primera fecha con alfa a 30 días para filas verificadas. Solo lectura. Correr desde el repo principal.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$HOME/Library/Logs/thesis-engine"; mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
chmod +x "$ROOT/scripts/launchd/run-medicion.sh"
PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.medicion.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.medicion</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/run-medicion.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Day</key><integer>12</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/medicion.log</string>
  <key>StandardErrorPath</key><string>$LOGS/medicion.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.thesis-engine.medicion" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "instalado com.thesis-engine.medicion (día 12 de cada mes 09:00, log en $LOGS/medicion.log)"
