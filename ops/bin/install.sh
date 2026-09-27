#!/bin/bash
# Idempotent installer for the headless Mac: env files, LaunchDaemons, sudoers rule, log rotation.
# Usage: ops/bin/install.sh [--dry-run [--out DIR]]
#   --dry-run  render everything into a scratch dir, lint it, print the sudo actions, touch nothing else.
# Run as your normal user; it calls sudo only where root is required.
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
user=$(id -un)
home=$HOME
labels=(engine gateway backup)
dry=0
out=""

die() { echo "install: $*" >&2; exit 1; }
warn() { echo "install: warning: $*" >&2; }
# Print root/system actions in dry-run, run them otherwise.
run() { if [ "$dry" = 1 ]; then printf '+ %s\n' "$*"; else "$@"; fi; }

while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) dry=1 ;;
    --out) out=${2:?--out needs a directory}; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

[ "$(uname -s)" = Darwin ] || die "macOS only"
[ "$(id -u)" -ne 0 ] || die "run as your user, not root (services run as the invoking user)"
for c in openssl plutil sed visudo; do command -v "$c" >/dev/null || die "missing $c"; done
for c in uv git ffmpeg sqlite3 tailscale; do command -v "$c" >/dev/null || warn "$c not found (RUNBOOK step 4)"; done

if [ "$dry" = 1 ]; then
  out=${out:-$(mktemp -d "${TMPDIR:-/tmp}/acestudio-dryrun.XXXXXX")}
  config=$out/config
  render=$out/LaunchDaemons
  echo "install: dry run into $out"
else
  config=$home/AceStudio/config
  render=$(mktemp -d "${TMPDIR:-/tmp}/acestudio-render.XXXXXX")
  trap 'rm -rf "$render"' EXIT
fi
mkdir -p "$render"
(umask 077 && mkdir -p "$config")
run mkdir -p "$home/AceStudio/audio" "$home/AceStudio/backups" "$home/Library/Logs/AceStudio"

# --- env files -------------------------------------------------------------------------------
project=$(sed -n 's/.*"default"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$repo/.firebaserc" | head -1)
[ -n "$project" ] || die "no default project in .firebaserc"
[ "$project" != "soniyo-studio-placeholder" ] || warn ".firebaserc still has the placeholder project id; fix SONIYO_CORS_ORIGINS after changing it"

get_var() { [ -f "$2" ] && sed -n "s/^$1=//p" "$2" | head -1 || true; }
is_secret() { case $1 in ''|__*__) return 1 ;; *) return 0 ;; esac; }

engine_key=$(get_var ACESTEP_API_KEY "$config/engine.env")
is_secret "$engine_key" || engine_key=$(get_var ACESTEP_API_KEY "$config/gateway.env")
is_secret "$engine_key" || engine_key=$(openssl rand -hex 32)

for name in engine gateway; do
  dest=$config/$name.env
  if [ -f "$dest" ]; then
    echo "install: keeping existing $dest"
  else
    # secrets via the environment, not argv, so `ps` never shows them
    (umask 077 && ENGINE_KEY="$engine_key" OWNER="$(openssl rand -hex 32)" PROJECT="$project" awk '{
        gsub(/__ENGINE_KEY__/, ENVIRON["ENGINE_KEY"]); gsub(/__OWNER_TOKEN__/, ENVIRON["OWNER"])
        gsub(/__FIREBASE_PROJECT__/, ENVIRON["PROJECT"]); print }' \
      "$repo/ops/env/$name.env.example" > "$dest")
    echo "install: wrote $dest"
  fi
  chmod 600 "$dest"
  ! grep -q '__[A-Z_]*__' "$dest" || die "$dest still has __PLACEHOLDER__ values"
done
[ "$(get_var ACESTEP_API_KEY "$config/engine.env")" = "$(get_var ACESTEP_API_KEY "$config/gateway.env")" ] \
  || die "ACESTEP_API_KEY differs between engine.env and gateway.env"
is_secret "$(get_var SONIYO_OWNER_TOKEN "$config/gateway.env")" || die "SONIYO_OWNER_TOKEN empty in gateway.env"

# --- plists + sudoers -------------------------------------------------------------------------
esc() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
for l in "${labels[@]}"; do
  f=$render/local.acestudio.$l.plist
  sed -e "s|__USER__|$(esc "$user")|g" -e "s|__HOME__|$(esc "$home")|g" \
    -e "s|__REPO__|$(esc "$repo")|g" -e "s|__CONFIG__|$(esc "$config")|g" \
    "$repo/ops/launchd/local.acestudio.$l.plist.template" > "$f"
  plutil -lint "$f"
done

# Lets the gateway watchdog (SONIYO_ENGINE_RESTART_CMD) restart the engine, and nothing else.
sudoers=$render/acestudio.sudoers
echo "$user ALL=(root) NOPASSWD: /bin/launchctl kickstart -k system/local.acestudio.engine" > "$sudoers"
visudo -cf "$sudoers" >/dev/null || die "generated sudoers rule failed visudo"
run sudo install -m 440 -o root -g wheel "$sudoers" /etc/sudoers.d/acestudio

# Log rotation for ~/Library/Logs/AceStudio (newsyslog runs every 30 min via launchd).
rotation=$render/acestudio.newsyslog.conf
sed -e "s|__HOME__|$(esc "$home")|g" -e "s|__USER__|$(esc "$user")|g" \
  -e "s|__GROUP__|$(esc "$(id -gn)")|g" "$repo/ops/newsyslog/acestudio.conf.template" > "$rotation"
! grep -q '__[A-Z_]*__' "$rotation" || die "$rotation still has __PLACEHOLDER__ values"
run sudo install -m 644 -o root -g wheel "$rotation" /etc/newsyslog.d/acestudio.conf

# --- load services ----------------------------------------------------------------------------
# shellcheck source=/dev/null
engine_dir=$(set -a; source "$config/engine.env"; echo "${SONIYO_ENGINE_DIR:-}")
for l in "${labels[@]}"; do
  label=local.acestudio.$l
  if [ "$l" = engine ] && [ ! -d "$engine_dir" ]; then
    warn "engine not loaded: $engine_dir missing (RUNBOOK step 5), rerun install.sh after cloning"
    continue
  fi
  run sudo install -m 644 -o root -g wheel "$render/$label.plist" "/Library/LaunchDaemons/$label.plist"
  run sudo launchctl bootout "system/$label" 2>/dev/null || true
  if [ "$dry" = 1 ]; then
    run sudo launchctl bootstrap system "/Library/LaunchDaemons/$label.plist"
  else
    # bootout returns before teardown finishes; retry briefly.
    for i in 1 2 3 4 5; do
      sudo launchctl bootstrap system "/Library/LaunchDaemons/$label.plist" 2>/dev/null && break
      [ "$i" = 5 ] && die "launchctl bootstrap $label failed; see: sudo launchctl print system/$label"
      sleep 1
    done
    echo "install: loaded $label"
  fi
done

port=$(get_var SONIYO_PORT "$config/gateway.env")
cat <<EOF

Next:
  tailscale serve --bg ${port:-8787}          # once; prints https://<mac>.<tailnet>.ts.net
  $repo/ops/bin/update-gateway.sh   # builds the web app into SONIYO_WEB_DIST
  $repo/ops/bin/healthcheck.sh
Owner token for pairing: grep SONIYO_OWNER_TOKEN $config/gateway.env
EOF
