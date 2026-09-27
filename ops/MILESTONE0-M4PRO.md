# Milestone 0 on an M4 Pro (2026-09-27)

First run of the gateway against the real engine. This is a dev Mac, not the target
M1: every number here is an upper bound on speed and says nothing final about M1
memory. The M1 runs in `RUNBOOK.md` still need doing.

## Setup

| | |
|---|---|
| Hardware | Apple M4 Pro, 24 GB unified memory, macOS 26 (Darwin 25.6) |
| Engine | ACE-Step-1.5 `ca1e85fe9430179831e6bc6be790c332190a3866` (2026-08-29), at `~/AceStudio/engine/ACE-Step-1.5` |
| Install | `uv sync` (~1.2 GB venv, CPython 3.12) + `acestep-download` + `--model acestep-5Hz-lm-0.6B`: 11 GB of checkpoints (the main bundle also brings the 1.7B LM), ~25 min on this link |
| Launch | `uv run acestep-api --host 127.0.0.1 --port 8001` with `ACESTEP_API_KEY`, `ACESTEP_LM_BACKEND=mlx`, `ACESTEP_CONFIG_PATH=acestep-v15-turbo`, `ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B`, `ACESTEP_QUEUE_WORKERS=1` |
| Memory tier (engine log) | `macOS MPS detected (17.8 GB unified memory, tier=tier6a)`: max 480 s with LM, 600 s without, batch 4 / 8. Matches the gateway's default `SONIYO_LM_CAP_SECONDS=480` |

## Results

All at 8 inference steps, FLAC out, batch 1. Memory is the engine's physical footprint
(`footprint <pid>`, sampled every 2 s); RSS is useless here, it showed 0.8–3.7 GB
while the Metal allocations were 18 GB.

| Run | Path | Wall | Breakdown | Peak footprint |
|---|---|---|---|---|
| 30 s, LM on, cold engine | direct `/release_task` | 116 s | ~78 s lazy model load, then 37.5 s generation (LM 2.9 s, DiT 34.6 s incl. offload) | not sampled (RSS 3.7 GB) |
| `/format_input`, 40 s | direct | 5 s | LM text pass only | 18 GB resident afterwards |
| 30 s Shiva preset, LM on | gateway `POST /jobs` | 37 s | generate 36.5 s (DiT 6.0 s), encode 0.3 s | 26 GB |
| 40 s Shiva preset over a 20 s LM cap | gateway, `SONIYO_LM_CAP_SECONDS=20` | 48 s | `/format_input` 4.3 s, LM-off render (DiT 15.1 s), encode 0.4 s | 27 GB |

Both gateway jobs went `generating → encoding → succeeded` over SSE; `GET /songs/{id}`
gave `duration_seconds` 30.0 / 40.0 with the engine's seed and
`engine_info {"dit": "acestep-v15-turbo", "lm": "acestep-5Hz-lm-0.6B"}`; a
`Range: bytes=0-1023` audio request returned 206; `ffprobe` on the MP3 read 30.000000 s
and 40.000000 s. The gateway itself peaked at 64 MB RSS.

## What the real engine does differently from its docs (fixed in the adapter)

- `/v1/models` is shadowed by the OpenRouter route (`{"object":"list","data":[]}`,
  no envelope, no auth); the real inventory is `/v1/model_inventory`.
- `/health` needs no key and says ok before models load (they load on the first job).
- An unknown task id is not missing from `/query_result`: it comes back as status 0
  (running) with result `"[]"`, which the gateway would have polled until its deadline.
- A failed task carries no error text; the reason ("Task 'repaint' requires source
  audio") is only in the engine log (`Job <id> FAILED: ...`).
- `/v1/stats` reports `avg_job_seconds` 5.0 before any job ran (a configured default),
  and later averages failed jobs (0 s) and the first job's model load in.

## Caveats

- Footprint above 24 GB means macOS was compressing/swapping (155 k pageouts): the
  engine keeps DiT, VAE, text encoder and LM resident. A 16 GB M1 will page harder;
  measure the 300/480/600 s runs there before trusting any ETA.
- The 0.6B LM's `/format_input` output is poor for this material: it rewrote Sanskrit
  lyrics into Cyrillic/Vietnamese text and invented genres ("post-harDCore"). The
  gateway keeps user lyrics and (with `keep_caption`) the caption, so here the pass only
  contributed a key (G minor). Worth judging by ear on the M1 whether it helps at all.
- The engine reports `lm_model` even for LM-off renders, so `engine_info.lm` is not
  proof the LM ran.
- Rendered FLACs stay in the checkout at `.cache/acestep/tmp/api_audio/`.
- Only 30 s and 40 s songs were rendered; long songs, the scenario checklist, and iPad
  Safari are still open.
