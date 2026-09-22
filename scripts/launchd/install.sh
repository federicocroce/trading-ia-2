#!/bin/zsh
# Instala (o reinstala) los agentes de launchd: la API y el web arrancan al iniciar sesión y se relanzan si se caen.
# Uso: scripts/launchd/install.sh        |  desinstalar: scripts/launchd/uninstall.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGS="$HOME/Library/Logs/thesis-engine"; mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
chmod +x "$ROOT/scripts/launchd/start-api.sh" "$ROOT/scripts/launchd/start-web.sh"
for svc in api web; do
  PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.$svc.plist"
  cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.$svc</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/start-$svc.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$LOGS/$svc.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$svc.err.log</string>
</dict></plist>
PL
  launchctl bootout "gui/$(id -u)/com.thesis-engine.$svc" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "instalado com.thesis-engine.$svc (logs en $LOGS)"
done

# El agente semanal de hechos externos (17/9): sábados 09:00, sin KeepAlive. Si la máquina duerme, corre al despertar.
chmod +x "$ROOT/scripts/launchd/run-hechos.sh"
PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.hechos.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.hechos</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/run-hechos.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>6</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/hechos.log</string>
  <key>StandardErrorPath</key><string>$LOGS/hechos.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.thesis-engine.hechos" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "instalado com.thesis-engine.hechos (sábados 09:00, log en $LOGS/hechos.log)"

# El agente de verificación (22/9): lunes a viernes 08:15, después del refresco de las 07:50. El script espera a que el
# Radar del día esté refrescado (hasta 3 horas), así que un corte de luz o una tapa cerrada no lo hacen correr antes.
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
