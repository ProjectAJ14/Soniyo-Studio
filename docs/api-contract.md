# Gateway API contract — `/api/v1`

The only interface between clients (web app, future native app) and the Mac.
Clients never call the engine. Change this file first, then both sides, in the
same commit. Python models: `gateway/src/soniyo_gateway/schemas.py`. TypeScript
mirror: `web/src/api/types.ts`. Field names are identical (snake_case) on both.

## Conventions

- JSON, UTF-8. Timestamps are ISO-8601 UTC strings (`2026-09-27T10:00:00Z`).
- `Authorization: Bearer <owner token>` on every call except bare `GET /health`.
  `GET /songs/{id}/audio` also accepts `?token=` because `<audio src>` cannot set
  headers.
- Errors — always this shape, with a matching HTTP status:

  ```json
  {"error": {"code": "engine_unavailable", "message": "Human sentence.", "retryable": true}}
  ```

  | code | status | retryable |
  |---|---|---|
  | `unauthorized` | 401 | false |
  | `not_found` | 404 | false |
  | `validation_failed` | 422 | false |
  | `conflict` (e.g. cancel a running job) | 409 | false |
  | `engine_unavailable` | 503 | true |
  | `internal` | 500 | true |

- CORS: only origins in `SONIYO_CORS_ORIGINS` (Firebase origins + `http://localhost:5173`).
- IDs are opaque strings (uuid4 hex).

## Types

### BuilderSpec (request body of `/compile`, `/jobs`; stored on jobs, songs, presets)

```json
{
  "client_job_id": "uuid, required on POST /jobs, ignored elsewhere",
  "preset_id": "id of the preset this spec was loaded from | null (becomes song.preset_id; dropped when saved as a preset)",
  "title": "Om Namah Shivaya",
  "theme": {"deity": "Shiva", "form": "mantra chant"},
  "style": "Deeply peaceful Shiva mantra meditation",
  "moods": ["calm", "devotional", "serene"],
  "vocals": {
    "type": "none | female | male | duet | choir",
    "character": ["soft", "warm"],
    "delivery": "chant | sing | hum | null",
    "notes": "free text",
    "language": "sa | hi | en | ... | null"
  },
  "instruments": [
    {"name": "tanpura", "role": "drone | lead | supporting | background | accent",
     "level": "very soft | soft | present | prominent",
     "frequency": "rare | occasional | regular | null (accent only)"}
  ],
  "ambience": {"reverb": "dry | light | medium | deep",
               "space": "intimate | room | hall | spacious",
               "dynamics": "steady | gentle swells | building"},
  "avoid": ["EDM", "heavy percussion"],
  "music": {"bpm": 60, "key": "C major | null", "time_signature": "4 | 3 | 6 | 2 | null"},
  "lyrics": {"text": "ॐ नमः शिवाय", "repeat": 108},
  "length": {"mode": "single", "total_seconds": 600},
  "engine": {"lm": "auto | on | off", "keep_caption": true, "seed": null,
             "lm_temperature": null, "caption_override": null}
}
```

Validation: `bpm` 30–300 or null; `total_seconds` 10–600; `repeat` 1–1000 or null;
`time_signature` one of `2 3 4 6` or null; lengths: `lyrics.text` ≤ 20000 and
`len(lyrics.text) × repeat` ≤ 50000, `vocals.notes` ≤ 2000, `caption_override` ≤ 5000,
`style` ≤ 2000, `title` ≤ 200, `client_job_id`/`preset_id`/`theme.*` ≤ 100, `music.key` ≤ 40,
`moods`/`avoid`/`vocals.character` ≤ 40 items of ≤ 80 chars, `instruments` ≤ 40;
`length.mode` is `single` in v1 (`loop` → 422 `validation_failed`, v1.1).
Every field except `client_job_id` on `/jobs` has a default, so `{}` compiles.
`engine.caption_override` (expert toggle, F9) replaces the compiled caption verbatim.
`lyrics.repeat` writes the text out N times, one per line (approximate count).
Auto (null) `music.time_signature` / `vocals.language` compile to `""` in `params`: the gateway
omits them so the LM/engine decides (instrumental sends `vocal_language: "unknown"`).

### CompileResult (`POST /compile`, `job.compiled`)

```json
{
  "caption": "Deeply peaceful Shiva mantra meditation, soft devotional female vocal, ...",
  "lyrics": "ॐ नमः शिवाय\nॐ नमः शिवाय\n...",
  "negative_prompt": "dramatic buildup, pop chorus, ...",
  "params": {"prompt": "...", "lyrics": "...", "lm_negative_prompt": "...",
             "bpm": 60, "key_scale": "", "time_signature": "4",
             "audio_duration": 600, "vocal_language": "sa",
             "thinking": false, "use_cot_caption": false,
             "seed": -1, "lm_temperature": 0.85,
             "batch_size": 1, "inference_steps": 8, "audio_format": "flac"},
  "plan": {"lm_text_pass": true, "lm_off_render": true, "lm_cap_seconds": 480},
  "routing": [{"item": "EDM", "target": "lm_negative_prompt"}],
  "notes": ["Above this Mac's 8:00 LM cap: lyrics are planned first, then rendered with the LM off."]
}
```

### Job

```json
{
  "id": "…", "client_job_id": "…", "title": "…",
  "state": "queued | compiling | generating | unit_ready | looping | encoding | succeeded | failed | cancelled",
  "position": 0,
  "spec": BuilderSpec, "compiled": CompileResult | null,
  "created_at": "…", "started_at": "… | null", "finished_at": "… | null",
  "elapsed_seconds": 12.5, "estimate_seconds_left": 240.0,
  "timings": {"compile": 0.1, "generate": 300.2, "encode": 4.0},
  "error": {"code": "…", "message": "…", "retryable": true} | null,
  "song_id": "… | null"
}
```

`position`: 0 = running, 1.. = place in queue, null when terminal.
Lifecycle: `queued → compiling → generating → encoding → succeeded`; any
non-terminal → `failed`; `queued` → `cancelled`. `unit_ready`/`looping` are v1.1.

### Song

```json
{
  "id": "…", "job_id": "…", "title": "…", "created_at": "…",
  "duration_seconds": 600.0, "favourite": false, "preset_id": "… | null",
  "spec": BuilderSpec, "compiled": CompileResult,
  "seed": 1234, "engine_info": {"dit": "acestep-v15-turbo", "lm": "acestep-5Hz-lm-0.6B"},
  "size_bytes": 83000000
}
```

### Preset

```json
{"id": "…", "name": "Shiva mantra meditation", "builtin": true,
 "spec": BuilderSpec, "created_at": "…", "updated_at": "…"}
```

### Health

```json
{
  "status": "ok",
  "version": "0.1.0",
  "engine": {"reachable": true, "status": "ok | down | unknown", "models": ["acestep-v15-turbo"],
             "last_error": "… | null"},
  "queue_depth": 1, "running_job_id": "… | null",
  "disk": {"free_bytes": 1, "total_bytes": 1, "used_by_library_bytes": 1, "low": false}
}
```

Bare `GET /health` (no or bad token) returns only `{"status": "ok", "version": "…"}`.

### Catalog

```json
{
  "instruments": [{"name": "tanpura", "default_role": "drone", "tags": ["indian", "drone"]}],
  "roles": ["drone", "lead", "supporting", "background", "accent"],
  "levels": ["very soft", "soft", "present", "prominent"],
  "frequencies": ["rare", "occasional", "regular"],
  "vocal_types": ["none", "female", "male", "duet", "choir"],
  "vocal_characters": ["soft", "warm", "breathy", "powerful", "soothing"],
  "vocal_deliveries": ["chant", "sing", "hum"],
  "languages": [{"code": "sa", "name": "Sanskrit"}],
  "moods": ["meditative", "devotional", "calm", "uplifting"],
  "deities": ["Shiva", "Krishna", "Ganesha", "Durga", "Hanuman"],
  "forms": ["bhajan", "aarti", "kirtan", "stotram", "chant"],
  "avoid_chips": ["EDM", "heavy percussion", "pop chorus", "cinematic climax"],
  "reverbs": ["dry", "light", "medium", "deep"],
  "spaces": ["intimate", "room", "hall", "spacious"],
  "dynamics": ["steady", "gentle swells", "building"],
  "keys": ["C major", "C minor", "..."],
  "time_signatures": ["2", "3", "4", "6"],
  "lm_cap_seconds": 480
}
```

## Endpoints

| Method | Path | Body → Response |
|---|---|---|
| GET | `/health` | → Health (reduced without token) |
| GET | `/catalog` | → Catalog |
| POST | `/compile` | BuilderSpec → CompileResult |
| POST | `/jobs` | BuilderSpec (with `client_job_id`) → 202 Job; repeat id → 200 same Job |
| GET | `/jobs?state=queued,generating&limit=50` | → `{"items": [Job]}` newest first |
| GET | `/jobs/{id}` | → Job |
| GET | `/jobs/{id}/events` | SSE: `event: job`, `data: Job` on every change; closes after a terminal state. Also accepts `?token=` (EventSource cannot set headers) |
| POST | `/jobs/{id}/cancel` | → Job (409 `conflict` unless `queued`) |
| POST | `/jobs/{id}/retry` | failed job → new 202 Job with the same spec |
| GET | `/songs?q=&favourite=true&limit=100` | → `{"items": [Song], "storage": {"used_bytes": 1, "free_bytes": 1}}` newest first |
| GET | `/songs/{id}` | → Song |
| PATCH | `/songs/{id}` | `{"title"?: str, "favourite"?: bool}` → Song |
| DELETE | `/songs/{id}` | → 204, removes audio files |
| GET | `/songs/{id}/audio?format=mp3\|flac&download=1` | audio bytes, honours `Range` (206) |
| POST | `/songs/{id}/regenerate` | `{"seed": "same" \| "new"}` → 202 Job (409 `conflict` for `same` when `song.seed` is null) |
| GET | `/presets` | → `{"items": [Preset]}` builtin first |
| POST | `/presets` | `{"name", "spec"}` → 201 Preset |
| GET | `/presets/{id}` | → Preset |
| PUT | `/presets/{id}` | `{"name", "spec"}` → Preset (409 for builtin) |
| DELETE | `/presets/{id}` | → 204 (409 for builtin) |

Gateway also serves the latest web build at `/` (same-origin fallback).
