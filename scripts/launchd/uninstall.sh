#!/bin/zsh
# Saca los agentes de launchd (la API y el web dejan de arrancar solos).
for svc in api web hechos; do
  launchctl bootout "gui/$(id -u)/com.thesis-engine.$svc" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/com.thesis-engine.$svc.plist"
  echo "desinstalado com.thesis-engine.$svc"
done
