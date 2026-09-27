#!/bin/bash
# Authenticated gateway health check. Exit 0 only if the gateway answers, the engine is
# reachable and disk is not low.
# Usage: healthcheck.sh [BASE_URL]   default http://127.0.0.1:$SONIYO_PORT
#   On the Mac the token comes from ~/AceStudio/config/gateway.env (override with SONIYO_ENV).
#   Elsewhere: SONIYO_OWNER_TOKEN=... healthcheck.sh https://<mac>.<tailnet>.ts.net
set -euo pipefail
env_file=${SONIYO_ENV:-$HOME/AceStudio/config/gateway.env}
if [ -r "$env_file" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$env_file"
  set +a
fi
: "${SONIYO_OWNER_TOKEN:?set SONIYO_OWNER_TOKEN or provide $env_file}"
url=${1:-http://127.0.0.1:${SONIYO_PORT:-8787}}
url=${url%/}

# Header via process substitution so the token never shows up in `ps`.
body=$(curl -fsS --max-time 10 -H @<(printf 'Authorization: Bearer %s\n' "$SONIYO_OWNER_TOKEN") \
  "$url/api/v1/health") || { echo "UNREACHABLE: $url (gateway down, Tailscale off, or token rejected)" >&2; exit 2; }
echo "$body"

command -v plutil >/dev/null || exit 0  # not a Mac: printed JSON is the result
field() { printf '%s' "$body" | plutil -extract "$1" raw -o - - 2>/dev/null || echo "?"; }
engine=$(field engine.reachable)
low=$(field disk.low)
[ "$engine" = true ] || { echo "ENGINE DOWN: $(field engine.last_error)" >&2; exit 3; }
[ "$low" != true ] || { echo "LOW DISK: $(field disk.free_bytes) bytes free" >&2; exit 4; }
echo "OK"
