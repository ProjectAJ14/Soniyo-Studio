#!/bin/bash
# Pull, sync deps, build the web app into SONIYO_WEB_DIST, restart the gateway, verify.
# Usage: update-gateway.sh   (run over SSH as the service user; asks for sudo once)
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
env_file=${SONIYO_ENV:-$HOME/AceStudio/config/gateway.env}
set -a
# shellcheck source=/dev/null
source "$env_file"
set +a
dist=${SONIYO_WEB_DIST:?SONIYO_WEB_DIST not set in $env_file}

git -C "$repo" pull --ff-only
(cd "$repo/gateway" && uv sync)
# Build in the repo first so a failed build never empties the served copy.
(cd "$repo/web" && npm ci && npm run build)
mkdir -p "$dist"
rsync -a --delete "$repo/web/dist/" "$dist/"

sudo launchctl kickstart -k system/local.acestudio.gateway
for _ in $(seq 30); do
  if "$repo/ops/bin/healthcheck.sh" >/dev/null 2>&1; then echo "gateway updated to $(git -C "$repo" rev-parse --short HEAD)"; exit 0; fi
  sleep 1
done
echo "gateway not healthy after 30 s; see ~/Library/Logs/AceStudio/gateway.err.log" >&2
"$repo/ops/bin/healthcheck.sh" || exit 1
