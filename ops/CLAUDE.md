# ops/ — headless Mac operations kit

Everything that runs the M1 as a server: launchd plist templates, env templates and the
scripts that install, check, back up and update it. Procedure: `RUNBOOK.md`.

| Path | What |
|---|---|
| `env/*.env.example` | Env templates. `install.sh` copies them to `~/AceStudio/config/` and fills `__PLACEHOLDER__` secrets |
| `launchd/*.plist.template` | LaunchDaemons (`UserName`, logs in `~/Library/Logs/AceStudio`). Placeholders: `__USER__ __HOME__ __REPO__ __CONFIG__` |
| `bin/run-engine.sh`, `bin/run-gateway.sh` | launchd entry points: source the env file (plists cannot), then `exec` |
| `bin/install.sh` | Idempotent installer; `--dry-run [--out DIR]` touches nothing outside the scratch dir |
| `bin/healthcheck.sh`, `backup.sh`, `update-gateway.sh`, `new-token.sh` | Day-2 operations |

## Rules

- No real secrets, hostnames or tailnet names in this directory, ever. Templates hold
  `__PLACEHOLDER__`s; real values live only in `~/AceStudio/config/*.env` (mode 600).
- Env var names match `gateway/src/soniyo_gateway/config.py`. A new setting there gets a
  line in `env/gateway.env.example` in the same change.
- Plists are templates, rendered by `install.sh`; never commit a rendered plist.
- Scripts: `#!/bin/bash`, `set -euo pipefail`, run as the service user, `sudo` only for
  launchd and `/etc/sudoers.d`. Never put a token on a command line (`ps` shows it):
  use `curl -H @<(printf ...)` or source the env file.
- Services bind 127.0.0.1 only; Tailscale Serve is the sole way in. Never Funnel.

## Checks

```sh
for f in ops/bin/*.sh; do shellcheck "$f" 2>/dev/null || bash -n "$f"; done
ops/bin/install.sh --dry-run          # renders + plutil -lint every plist, prints sudo actions
python3 -m json.tool firebase.json >/dev/null
```
