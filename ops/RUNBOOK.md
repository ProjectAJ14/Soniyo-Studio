# Headless Mac runbook

Turns the M1 into a box that boots, connects and serves with nobody at it. One session
with a display sets it up; everything after is SSH. Source: PRD "Headless Mac runbook"
and "Engine setup". Scripts live in `ops/bin/`; run them as your normal user.

Layout on the Mac (all created by `install.sh` or the steps below):

| Path | What |
|---|---|
| `~/AceStudio/gateway` | this repo (gateway, web, ops) |
| `~/AceStudio/engine/ACE-Step-1.5` | the engine, pinned commit |
| `~/AceStudio/config/{engine,gateway}.env` | secrets, mode 600, never committed |
| `~/AceStudio/soniyo.sqlite3`, `~/AceStudio/audio/` | library (`SONIYO_DATA_DIR`) |
| `~/AceStudio/web-dist` | built SPA the gateway serves (`SONIYO_WEB_DIST`) |
| `~/AceStudio/backups` | nightly database snapshots |
| `~/Library/Logs/AceStudio/*.log` | service logs (rotated, step 13) |
| `/etc/newsyslog.d/acestudio.conf` | log rotation, rendered from `ops/newsyslog/` |
| `/Library/LaunchDaemons/local.acestudio.{engine,gateway,backup}.plist` | services |

## Setup, step by step

1. **One-time access.** Attach a display and keyboard. System Settings → General →
   Sharing: turn on Remote Login and Screen Sharing; note the Mac's name. From now on:
   `ssh <you>@<mac>.local` (or the Tailscale name once step 8 is done).

2. **Boot without a login.** The services are LaunchDaemons with `UserName`, so they
   start before anyone logs in. FileVault keeps the disk locked after a reboot, so either
   turn it off (`sudo fdesetup disable`) or only ever reboot with
   `sudo fdesetup authrestart`. Check: `fdesetup status`.

3. **Power and sleep.**
   ```sh
   sudo pmset -a sleep 0 disksleep 0 displaysleep 0
   sudo pmset -a autorestart 1        # power back on after an outage (desktops only: MacBooks
                                      # lack it, `pmset -g cap` omits it and pmset ignores it)
   pmset -g                           # verify
   ```
   Keep it plugged in, lid open. Only if the lid must close: `sudo pmset -a disablesleep 1`.

4. **Tools.**
   ```sh
   xcode-select --install
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   brew install uv git ffmpeg node tailscale
   ```
   `node` is only needed to build the web app on the Mac (`update-gateway.sh`).

5. **Engine.**
   ```sh
   git clone https://github.com/ace-step/ACE-Step-1.5 ~/AceStudio/engine/ACE-Step-1.5
   cd ~/AceStudio/engine/ACE-Step-1.5
   git checkout ca1e85fe9430179831e6bc6be790c332190a3866   # pinned; record changes in the decisions log
   uv sync
   uv run acestep-download
   uv run acestep-download --model acestep-5Hz-lm-0.6B
   ```
   Edit the variables at the top of `start_api_server_macos.sh`: `CHECK_UPDATE="false"`,
   and keep host/port/models in agreement with `~/AceStudio/config/engine.env`
   (written in step 7). The launcher already selects the MLX backend.

6. **Gateway.**
   ```sh
   git clone <this repo> ~/AceStudio/gateway
   cd ~/AceStudio/gateway/gateway && uv sync
   ```
   Set your real Firebase project id in `.firebaserc` before step 7 (it feeds
   `SONIYO_CORS_ORIGINS`). Migrations run automatically when the gateway starts.

7. **Services.**
   ```sh
   ~/AceStudio/gateway/ops/bin/install.sh --dry-run   # renders + lints into a scratch dir, prints sudo actions
   ~/AceStudio/gateway/ops/bin/install.sh
   ```
   `install.sh` is safe to rerun. It writes the env files (32-byte tokens from
   `openssl rand -hex 32`) only if they are missing, `chmod 600`s them, renders the
   plists with your user and paths, `plutil -lint`s them, installs a sudoers rule that
   allows only `launchctl kickstart -k system/local.acestudio.engine` (the gateway's
   watchdog restart), then `bootout`/`bootstrap`s each daemon. If the engine is not
   cloned yet it skips loading it; rerun after step 5. Check:
   ```sh
   sudo launchctl print system/local.acestudio.gateway | grep -E 'state|last exit'
   sudo launchctl print system/local.acestudio.engine  | grep -E 'state|last exit'
   ```

8. **Tailscale.**
   ```sh
   sudo brew services start tailscale
   sudo tailscale up
   ```
   In the admin console enable MagicDNS and HTTPS certificates, then:
   ```sh
   tailscale serve --bg 8787
   tailscale serve status          # note https://<mac>.<tailnet>.ts.net
   ```
   Never enable Funnel.

9. **iPad.** Install Tailscale from the App Store, join the same tailnet. Open the web app
   (`https://soniyo-studio.web.app`), pair it with the `ts.net` URL and the owner token
   (`grep SONIYO_OWNER_TOKEN ~/AceStudio/config/gateway.env`), then Share → Add to Home
   Screen.

10. **Health checks.**
    ```sh
    ~/AceStudio/gateway/ops/bin/healthcheck.sh                                   # on the Mac
    SONIYO_OWNER_TOKEN=<token> ops/bin/healthcheck.sh https://<mac>.<tailnet>.ts.net   # any tailnet device
    curl https://<mac>.<tailnet>.ts.net/api/v1/health                         # bare, no token
    tail -f ~/Library/Logs/AceStudio/{gateway,engine}.err.log
    ```
    `healthcheck.sh` exits 0 OK, 2 unreachable or token rejected, 3 engine down, 4 low disk.

11. **Updates.**
    - Gateway + web served by the Mac: `~/AceStudio/gateway/ops/bin/update-gateway.sh`
      (`git pull --ff-only`, `uv sync`, `npm ci && npm run build`, copy into
      `SONIYO_WEB_DIST`, `sudo launchctl kickstart -k system/local.acestudio.gateway`,
      waits for a healthy check).
    - Engine: check out the new commit in a second clone, run the Milestone 0 procedure
      below against it on another port, and only then move the pin and
      `sudo launchctl kickstart -k system/local.acestudio.engine`.
    - Web app on Firebase (from a dev machine): `cd web && npm run build && cd .. && firebase deploy --only hosting`.
    - Rotate secrets: `ops/bin/new-token.sh` (owner token; re-pair the iPad) or
      `ops/bin/new-token.sh engine-key`.

12. **Backups.** `local.acestudio.backup` runs `ops/bin/backup.sh` daily at 03:30: an
    online `sqlite3 .backup` into `SONIYO_BACKUP_DIR` (integrity-checked, newest 14
    kept) and, on Sundays, mirrors `~/AceStudio/audio/` to `SONIYO_BACKUP_AUDIO_DEST/audio`
    (external drive or NAS; set it in `gateway.env`) with `rsync --delete`, so songs
    deleted in the app leave the mirror too. Files deleted from the library are moved to
    `SONIYO_BACKUP_AUDIO_DEST/audio-deleted/<YYYYMMDD>/` (newest 8 weeks kept), so a delete
    stays recoverable for two months. Run it now:
    `ops/bin/backup.sh ~/AceStudio/config/gateway.env --audio`.
    Restore: stop the gateway (`sudo launchctl bootout system/local.acestudio.gateway`),
    copy a snapshot over `~/AceStudio/soniyo.sqlite3`, remove any `-wal`/`-shm` next to
    it, then `sudo launchctl bootstrap system /Library/LaunchDaemons/local.acestudio.gateway.plist`.

13. **Log rotation.** Two mechanisms, nothing to run by hand:
    - `gateway.log` (JSON lines) is rotated by the gateway itself: Python
      `RotatingFileHandler`, 5 MB × 5 archives (`gateway.log.1`…`.5`). launchd sends the
      gateway's stdout to `gateway.out.log`, so nothing else writes `gateway.log`.
    - Everything launchd writes (`engine{,.err}.log`, `gateway.{out,err}.log`,
      `backup{,.err}.log`) is rotated by macOS `newsyslog` (runs every 30 min):
      `install.sh` renders `ops/newsyslog/acestudio.conf.template` into
      `/etc/newsyslog.d/acestudio.conf` — at 10 MB, 7 gzipped archives (`engine.log.0.gz`…).
      Check it with `sudo newsyslog -nv -f /etc/newsyslog.d/acestudio.conf`.
    - Caveat: launchd keeps a long-running service's log file open, so after a rotation
      the engine/gateway keep writing to the rotated file until they restart (backup
      reopens its log every run). If `engine.log` stays empty after a rotation, run
      `sudo launchctl kickstart -k system/local.acestudio.engine`.

## Milestone 0 procedure

Run on the Mac against the engine directly (the gateway is not needed). Load the key once:

```sh
set -a; source ~/AceStudio/config/engine.env; set +a
E=http://127.0.0.1:8001
H="Authorization: Bearer $ACESTEP_API_KEY"
curl -fsS $E/health; echo                       # open; ok even before models load
curl -fsS -H "$H" $E/v1/model_inventory; echo   # not /v1/models: that is the OpenRouter route, always empty
grep -iE 'tier|memory|gpu' ~/Library/Logs/AceStudio/engine*.log | tail   # detected memory tier
```

Models load lazily on the first job (~75 s on an M4 Pro), so time runs after a warm-up job.

Helper: submit, poll until done, print total seconds and the result JSON.

```sh
m0() {  # m0 <seconds> <thinking true|false> <caption> [lyrics] [lm_negative_prompt] [vocal_language]
  local body id t0 r s
  body=$(jq -n --argjson d "$1" --argjson th "$2" --arg p "$3" --arg l "${4:-}" --arg n "${5:-}" --arg v "${6:-}" \
    '{prompt:$p, lyrics:$l, lm_negative_prompt:$n, audio_duration:$d, thinking:$th,
      batch_size:1, inference_steps:8, audio_format:"flac", use_random_seed:true}
     + (if $v == "" then {} else {vocal_language:$v} end)')
  t0=$(date +%s)
  id=$(curl -fsS -H "$H" -H 'Content-Type: application/json' -d "$body" $E/release_task | jq -r .data.task_id)
  echo "task $id"
  while :; do
    r=$(curl -fsS -H "$H" -H 'Content-Type: application/json' -d "{\"task_id_list\":[\"$id\"]}" $E/query_result)
    s=$(echo "$r" | jq -r '.data[0].status')
    [ "$s" != 0 ] && break
    sleep 5
  done
  echo "status $s (1 ok, 2 failed) in $(( $(date +%s) - t0 )) s"
  echo "$r" | jq '.data[0].result | fromjson? // .'
}
```

(`jq` ships with recent macOS; otherwise `brew install jq`.) Watch peak memory in a second SSH session
(RSS misses the Metal allocations, so use the physical footprint):
`while sleep 5; do footprint $(pgrep -f 'acestep-api --host' | tail -1) | sed -n 2p; done`.
Fetch a result to listen to: `curl -fsS -H "$H" "$E/v1/audio?path=<path from result file>" -o run.flac`.

Record every run (total time, peak memory, clamp warnings in `engine.err.log`) in the
PRD decisions log.

- [ ] **Engine serving with a key:** the `/v1/model_inventory` call above returns the
      models; the same call without `-H "$H"` is rejected with 401 (`/health` is open by design).
- [ ] **Scenario 1 with the LM:** `m0 60 true "<scenario 1 caption>" "<lyrics>"`, then
      `m0 300 …` and `m0 480 …`. For 480 s note whether the log shows a clamp.
- [ ] **600 s through the LM text pass then LM off:**
      ```sh
      curl -fsS -H "$H" -H 'Content-Type: application/json' $E/format_input \
        -d '{"prompt":"<caption>","lyrics":"<lyrics>","param_obj":"{\"duration\":600}"}' | jq .data
      m0 600 false "<caption from format_input>" "<lyrics from format_input>"
      ```
      Compare against the 480 s LM-on render.
- [ ] **Scenario 2:** pick a contrasting 5-minute song for another deity;
      `m0 300 true "<caption>" "<lyrics>"`; review style and instrument adherence.
- [ ] **Lyrics script and language:** four 60 s runs: Devanagari vs romanised lyrics,
      each with `vocal_language` `sa` and `hi` (6th argument).
- [ ] **Avoid list:** A/B `m0 60 true "<caption with 'no EDM, no heavy percussion'>"`
      against `m0 60 true "<caption>" "<lyrics>" "EDM, heavy percussion, pop chorus"`.
- [ ] **Memory tier:** read from the engine log (grep above).
- [ ] **iPad Safari:** deploy the web app to Firebase, open it on the iPad with Tailscale
      on, pair, and confirm the Server screen loads health from the `ts.net` URL.

## Troubleshooting

**Mac unreachable** (app shows the Tailscale banner, `healthcheck.sh` exits 2 remotely):
- iPad: Tailscale app connected? Same tailnet?
- `tailscale status` from another device: is the Mac online? If not, it is asleep, off,
  or stuck at FileVault unlock after a reboot (step 2).
- On the Mac: `tailscale serve status` should list `:443 → 127.0.0.1:8787`; rerun
  `tailscale serve --bg 8787` if empty. Then `ops/bin/healthcheck.sh` locally: if this
  fails too, it is the gateway (below), not the network.

**Token rejected** (401, app asks to pair again):
- The token on the iPad must equal `SONIYO_OWNER_TOKEN` in `gateway.env`. Rotated
  recently? Re-pair. Lost it? `ops/bin/new-token.sh` prints a fresh one.
- CORS error in Safari instead of 401: the page origin is missing from
  `SONIYO_CORS_ORIGINS`; add it and `sudo launchctl kickstart -k system/local.acestudio.gateway`.

**Gateway down** (local `healthcheck.sh` exits 2):
- `sudo launchctl print system/local.acestudio.gateway | grep -E 'state|last exit'`
- `tail -50 ~/Library/Logs/AceStudio/gateway.err.log`. Common: token under 32 chars,
  `uv` not on the plist `PATH`, port 8787 taken (`lsof -iTCP:8787 -sTCP:LISTEN`).

**Job failed with "the engine log has the reason"**: the engine sends no error text
with a failed task. `grep FAILED ~/Library/Logs/AceStudio/engine*.log | tail` shows
`Job <id> FAILED: <reason>`.

**Engine down** (`healthcheck.sh` exits 3, jobs fail with Retry):
- `tail -100 ~/Library/Logs/AceStudio/engine.err.log` (out-of-memory, missing models,
  key mismatch). Keys must match: `grep -h ACESTEP_API_KEY ~/AceStudio/config/*.env | sort -u | wc -l` is 1.
- Restart: `sudo launchctl kickstart -k system/local.acestudio.engine`. The gateway does
  this itself after 3 failed health checks; if it cannot, check
  `sudo cat /etc/sudoers.d/acestudio` (rerun `install.sh`).
- Crash loop: launchd waits `ThrottleInterval` (30 s) between restarts; `last exit`
  in `launchctl print` shows the code.

**Low disk** (`healthcheck.sh` exits 4, Server screen warns):
- `df -h ~` and `du -sh ~/AceStudio/{audio,backups} ~/Library/Logs/AceStudio ~/.cache/huggingface 2>/dev/null`
- Delete songs from the app, prune `~/AceStudio/backups`. Logs rotate automatically
  (step 13); force a rotation with `sudo newsyslog -F -f /etc/newsyslog.d/acestudio.conf`.
- Old engine checkouts and model caches are the usual space hogs (the checkpoints are
  ~11 GB). The engine also keeps every render in `~/AceStudio/engine/ACE-Step-1.5/.cache/acestep/tmp/api_audio/`;
  the gateway has its own copy, so these can be deleted.
