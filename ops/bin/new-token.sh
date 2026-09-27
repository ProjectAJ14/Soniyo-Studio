#!/bin/bash
# Rotate a secret and restart what uses it.
# Usage: new-token.sh [owner|engine-key]
#   owner       new SONIYO_OWNER_TOKEN (default); prints it so you can re-pair the iPad
#   engine-key  new ACESTEP_API_KEY in engine.env and gateway.env; restarts both
set -euo pipefail
config=${SONIYO_CONFIG_DIR:-$HOME/AceStudio/config}
new=$(openssl rand -hex 32)

set_var() {  # set_var NAME FILE
  [ -f "$2" ] || { echo "missing $2 (run ops/bin/install.sh)" >&2; exit 1; }
  grep -q "^$1=" "$2" || { echo "$1 not found in $2" >&2; exit 1; }
  sed -i '' "s/^$1=.*/$1=$new/" "$2"
  chmod 600 "$2"
}

case ${1:-owner} in
  owner)
    set_var SONIYO_OWNER_TOKEN "$config/gateway.env"
    sudo launchctl kickstart -k system/local.acestudio.gateway
    echo "New owner token (re-pair the iPad in Server settings):"
    echo "$new"
    ;;
  engine-key)
    set_var ACESTEP_API_KEY "$config/engine.env"
    set_var ACESTEP_API_KEY "$config/gateway.env"
    sudo launchctl kickstart -k system/local.acestudio.engine
    sudo launchctl kickstart -k system/local.acestudio.gateway
    echo "Engine key rotated; engine and gateway restarted."
    ;;
  *) sed -n '2,5p' "$0" >&2; exit 1 ;;
esac
