#!/bin/bash
# Nightly SQLite snapshot (keeps 14) and weekly audio rsync (Sundays, or with --audio).
# Run by local.acestudio.backup. Usage: backup.sh <gateway.env> [--audio]
set -euo pipefail
env_file=${1:?usage: backup.sh <gateway.env> [--audio]}
set -a
# shellcheck source=/dev/null
source "$env_file"
set +a
data=${SONIYO_DATA_DIR:?SONIYO_DATA_DIR not set}
db=$data/soniyo.sqlite3
dest=${SONIYO_BACKUP_DIR:-$data/backups}
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') backup: $*"; }

mkdir -p "$dest"
if [ -f "$db" ]; then
  snap=$dest/soniyo-$(date +%Y%m%d-%H%M%S).sqlite3
  case $snap in *"'"*) log "refusing path with a quote: $snap"; exit 1 ;; esac
  sqlite3 "$db" ".backup '$snap'"  # online, WAL-safe copy
  # Single self-contained file: drop WAL mode on the copy, then verify it.
  check=$(sqlite3 "$snap" 'PRAGMA journal_mode=DELETE;' 'PRAGMA integrity_check;' | tail -1)
  [ "$check" = ok ] || { log "integrity_check failed on $snap: $check"; exit 1; }
  rm -f "$snap-wal" "$snap-shm"  # WAL already checkpointed by the mode switch; macOS leaves the index
  log "db -> $snap"
  # Names are fixed-format, so ls parsing is safe here.
  # shellcheck disable=SC2012
  ls -1t "$dest"/soniyo-*.sqlite3 | tail -n +15 | while read -r old; do rm -f "$old"; done
else
  log "no database yet at $db, skipping snapshot"
fi

if [ "$(date +%u)" = 7 ] || [ "${2:-}" = --audio ]; then
  target=${SONIYO_BACKUP_AUDIO_DEST:-}
  if [ -z "$target" ]; then
    log "SONIYO_BACKUP_AUDIO_DEST empty, skipping audio"
  elif [ ! -d "$target" ]; then
    log "audio target $target not mounted"; exit 1
  else
    # No --delete: a song removed from the library stays in the backup.
    rsync -a "$data/audio/" "$target/audio/"
    log "audio -> $target/audio"
  fi
fi
