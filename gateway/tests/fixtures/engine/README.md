Real `acestep-api` responses captured with curl on 2026-09-27 from ACE-Step-1.5 commit
`ca1e85fe9430179831e6bc6be790c332190a3866` (MLX backend, acestep-v15-turbo +
acestep-5Hz-lm-0.6B, Apple M4 Pro). Only change: the home directory in audio paths is
rewritten to `/Users/owner`. No keys are recorded.

| File | Request |
|---|---|
| `health.json` | `GET /health` (no auth needed; models lazy-load, so `models_initialized` is false) |
| `model_inventory.json` | `GET /v1/model_inventory` (`/v1/models` is the OpenRouter route: `{"object":"list","data":[]}`) |
| `stats.json` | `GET /v1/stats` on a fresh engine (`avg_job_seconds` 5.0 is the configured default) |
| `release_task.json` | `POST /release_task`, 30 s LM-on job |
| `query_result_running.json` | `POST /query_result` while that job loaded models |
| `query_result_succeeded.json` | the same job after success |
| `query_result_failed.json` | `task_type: repaint` with no source audio (no error text; only the engine log has it) |
| `query_result_unknown.json` | an id the engine never issued: status 0 with result `"[]"` |
| `format_input.json` | `POST /format_input`, 40 s Shiva caption + lyrics |
| `error_401.json` | any authed route with a wrong key (HTTP 401) |
