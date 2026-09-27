#!/bin/bash
# Nightly SQLite snapshot (keeps 14) and weekly audio mirror (Sundays, or with --audio):
# library deletes propagate, removed files are kept 8 weeks in dated audio-deleted/ folders.
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
  elif [ ! -d "$data/audio" ]; then
    log "no audio dir at $data/audio, skipping audio (refusing to mirror nothing)"
  else
    # Mirror, so library deletes propagate. Files gone from the library are first moved to a
    # dated folder instead of being lost (by hand: macOS openrsync ignores --backup-dir on
    # --delete); song files are immutable, so nothing is overwritten. Newest 8 folders kept.
    trash=$target/audio-deleted/$(date +%Y%m%d)
    mkdir -p "$target/audio"
    (cd "$target/audio" && find . -type f) | while IFS= read -r f; do
      [ -e "$data/audio/$f" ] && continue
      mkdir -p "$trash/$(dirname "$f")" && mv "$target/audio/$f" "$trash/$f"
    done
    rsync -a --delete "$data/audio/" "$target/audio/"
    log "audio -> $target/audio (library deletes kept in $target/audio-deleted/)"
    if [ -d "$target/audio-deleted" ]; then
      # Names are fixed-format dates, so ls parsing is safe here.
      # shellcheck disable=SC2012
      ls -1d "$target"/audio-deleted/*/ 2>/dev/null | sort -r | tail -n +9 \
        | while read -r old; do rm -rf "$old"; done
    fi
  fi
fi
