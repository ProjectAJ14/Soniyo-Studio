# Soniyo Studio

Generate full songs from an iPad browser while a headless M1 Mac runs ACE-Step 1.5
locally. PRD: `PRD/ACE-Step Web Studio — PRD.md` (the spec; v1 = rows marked v1).

## System boundaries (do not cross)

```
iPad Safari ──HTTPS──▶ Tailscale Serve ──▶ gateway (127.0.0.1:8787) ──▶ ACE-Step engine (127.0.0.1:8001)
   web/ (SPA)                               gateway/                     external, never called by web/
```

| Path | Owns | Must never |
|---|---|---|
| `docs/api-contract.md` | The one client↔gateway contract (`/api/v1`) | Drift from `schemas.py` / `types.ts` |
| `gateway/` | Auth, CORS, compiler, queue, engine adapter, library, SSE, static SPA | Leak engine shapes or the engine key to clients |
| `gateway/src/soniyo_gateway/engine/` | Only code that speaks the engine's HTTP API | Be imported by routes directly — go through `worker.py` |
| `web/` | Builder, queue, library, player, server screens | Call anything but the gateway via `web/src/api/client.ts` |
| `ops/` | launchd plists, env templates, scripts | Hold real secrets |

Changing the contract: edit `docs/api-contract.md`, `gateway/.../schemas.py` and
`web/src/api/types.ts` in the same commit.

## Commands

| Task | Command |
|---|---|
| Gateway dev (fake engine) | `cd gateway && SONIYO_ENGINE=fake uv run soniyo-gateway` |
| Gateway tests | `cd gateway && uv run pytest -q` |
| Gateway lint | `cd gateway && uv run ruff check .` |
| Web dev | `cd web && npm run dev` (http://localhost:5173) |
| Web checks | `cd web && npm run typecheck && npm run lint && npm test && npm run build` |

## Working rules

- Every async surface models `idle | loading | success | error` explicitly (see
  nearest CLAUDE.md for the helper). No bare spinners, no swallowed errors.
- Commit small and often, Conventional Commits, one concern per commit.
- A change is done when its checks pass; say which checks you ran.
- Path-scoped rules live in `.claude/rules/`; subsystem detail in nested `CLAUDE.md`.
