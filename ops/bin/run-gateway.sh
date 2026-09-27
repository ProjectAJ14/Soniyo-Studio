#!/bin/bash
# launchd entry for local.acestudio.gateway. Usage: run-gateway.sh <gateway.env>
set -euo pipefail
env_file=${1:?usage: run-gateway.sh <gateway.env>}
set -a
# shellcheck source=/dev/null
source "$env_file"
set +a
cd "$(dirname "$0")/../../gateway"
exec uv run soniyo-gateway
