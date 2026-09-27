#!/bin/bash
# launchd entry for local.acestudio.engine. Plists cannot source env files, so this does.
# Usage: run-engine.sh <engine.env>
set -euo pipefail
env_file=${1:?usage: run-engine.sh <engine.env>}
set -a
# shellcheck source=/dev/null
source "$env_file"
set +a
cd "${SONIYO_ENGINE_DIR:?SONIYO_ENGINE_DIR not set in $env_file}"
# Prefer the official macOS launcher (MLX backend); fall back to the plain entry point.
if [ -f ./start_api_server_macos.sh ]; then
  exec /bin/bash ./start_api_server_macos.sh
fi
exec uv run acestep-api  # reads ACESTEP_API_HOST/PORT from the environment
