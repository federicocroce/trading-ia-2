#!/bin/zsh
# Arranque del web (Vite) para launchd.
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
exec pnpm --filter @thesis/web dev
