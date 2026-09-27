# Soniyo Studio

Generate full songs from an iPad browser while a headless M1 Mac runs
[ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) locally. Compose a song in the
builder, queue it, and play or download it from the library. Nothing leaves your tailnet.

```
 iPad Safari (PWA)                        headless M1 Mac
 ┌──────────────┐   HTTPS    ┌────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
 │  web/  SPA   │──────────▶ │  Tailscale Serve   │──▶│ gateway/             │──▶│ ACE-Step engine     │
 │ (Firebase or │  *.ts.net  │  TLS, tailnet only │   │ 127.0.0.1:8787       │   │ 127.0.0.1:8001      │
 │  gateway /)  │            └────────────────────┘   │ auth, queue, library │   │ MLX, one job a time │
 └──────────────┘                                     │ SQLite + ~/AceStudio │   └─────────────────────┘
                                                      └──────────────────────┘
                                   launchd (ops/) keeps gateway + engine running, backs up nightly
```

The web app talks only to the gateway (`/api/v1`, owner token on every call); only the
gateway knows the engine key.

## Local development

Needs Python 3.12 with [uv](https://docs.astral.sh/uv/) and Node 20+. No engine required.

```sh
# terminal 1: gateway with the fake engine
export SONIYO_OWNER_TOKEN=$(openssl rand -hex 32); echo "$SONIYO_OWNER_TOKEN"
cd gateway && SONIYO_ENGINE=fake SONIYO_DATA_DIR=/tmp/soniyo uv run soniyo-gateway   # http://127.0.0.1:8787

# terminal 2: web app
cd web && npm install && npm run dev   # http://localhost:5173
```

Pair the web app with `http://127.0.0.1:8787` and the printed token.

Checks: `cd gateway && uv run pytest -q && uv run ruff check .` and
`cd web && npm run typecheck && npm run lint && npm test && npm run build`.

## Docs

- [PRD](PRD/ACE-Step%20Web%20Studio%20%E2%80%94%20PRD.md): the spec (v1 = rows marked v1)
- [API contract](docs/api-contract.md): the one client ↔ gateway interface
- [Runbook](ops/RUNBOOK.md): setting up and operating the headless Mac, Milestone 0 procedure
- Deploy the web app: `cd web && npm run build && cd .. && firebase deploy --only hosting`
  (set your project id in `.firebaserc` first)
