# gateway/

FastAPI service on 127.0.0.1:8787. The only thing that talks to the engine.
Contract: `../docs/api-contract.md`. Runs one job at a time.

## Module map (layers call downward only)

| Layer | Module | Responsibility |
|---|---|---|
| HTTP | `main.py` | App factory, lifespan (db, worker, watchdog), CORS, error handlers, static SPA at `/` |
| HTTP | `auth.py` | Bearer token check (constant-time); `?token=` only for audio + SSE |
| HTTP | `routes/*.py` | Thin: parse schema → call service → return schema |
| Service | `jobs.py` | Create (idempotent on `client_job_id`), cancel, retry, list, to-schema with position/ETA |
| Service | `worker.py` | Single consumer: compile → engine → fetch → encode → song. Recovery on startup |
| Service | `events.py` | In-process pub/sub of Job snapshots for SSE |
| Service | `library.py` | Songs + presets CRUD, storage accounting, file deletion |
| Service | `audio.py` | ffmpeg FLAC→MP3, duration probe, Range file responses |
| Pure | `compiler.py`, `catalog.py` | Spec → caption/params; catalogue + built-in presets |
| Adapter | `engine/` | `Engine` protocol, `AceStepEngine` (HTTP), `FakeEngine` (dev/tests) |
| Data | `db.py`, `repo.py`, `migrations/` | SQLite WAL, forward-only SQL migrations, all SQL (one connection, every statement under `Repo._lock`: sync routes run in threads) |

## States

Job states are the 9 in `schemas.JobState`. Transitions happen only in
`worker.py`/`jobs.py` via `repo.update_job`, which also publishes to `events`.
Engine health is tracked as `ok | down | unknown` with `last_error`.

## Checks

`uv run pytest -q && uv run ruff check .` — tests use `FakeEngine` + tmp data dir,
never the network, never `~/AceStudio`. `tests/test_e2e_http.py` spawns a real
uvicorn on a free 127.0.0.1 port (fake engine, needs ffmpeg) and drives the HTTP flow.
