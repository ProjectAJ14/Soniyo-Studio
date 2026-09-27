# ACE-Step Web Studio — PRD

Sep 27, 2026 · @Ajay

## Overview

ACE-Step Web Studio lets you generate full songs from an iPad browser while a headless M1 MacBook Pro runs all inference locally. Version 1 covers text-to-music, a job queue, and a song library.

### Problem

ACE-Step 1.5 produces strong music locally, but its bundled UIs assume you sit at the machine running it. The spare M1 has a broken screen, and the iPad cannot run the models comfortably. There is no clean way to drive the Mac from the iPad, queue long generations, and keep the results.

### Product summary

- A web app (static SPA) opened in Safari on the iPad, installable to the Home Screen.
- A small gateway service on the Mac that owns the job queue, song storage, auth, and CORS.
- The ACE-Step engine on the Mac, reachable only by the gateway.

### Goals

1. Generate a song from the iPad with a prompt, optional lyrics, optional metadata (duration, BPM, key, language), and a configurable palette of vocals and instruments.
2. Keep all inference and audio on your own hardware; no cloud GPU.
3. Handle long runs gracefully: queued jobs, live progress, results that survive a locked iPad or a closed tab.
4. Keep operations near zero: the Mac starts everything on boot and recovers from crashes without a screen.
5. Expose a stable API so a native iPad app can replace the web UI later without touching the Mac.

### Non-goals for v1

- Running any model on the iPad.
- Multiple users, public sharing, or accounts beyond a single owner token.
- LoRA training from the web UI (it stays available in the Gradio UI on the Mac).
- A native iPad app, App Store release, or monetisation.

### Success metrics

| Metric | Target |
| --- | --- |
| End-to-end generation from the iPad | Works with zero interaction on the Mac |
| 5- and 10-minute songs in any style | Both lengths render on the M1 from the iPad, for both reference scenarios |
| Tap-to-playable time, 5-minute song, turbo model | Baseline measured in Milestone 0; v1 target set from it |
| Job survives iPad sleep or tab close | 100% of jobs finish and appear in the library |
| Unattended uptime | 7 days without a manual restart |
| Unauthenticated requests reaching the engine | 0 |

## Users and use cases

The only v1 user is you, the owner, working from an iPad on home Wi-Fi. The design leaves room for trusted guests and a native app later.

- **Owner (primary):** experiments with prompts, iterates on settings, keeps a library, and moves finished audio into other iPad apps through Files.
- **Trusted guest (later):** someone on the same network or tailnet who can generate with a shared token but cannot delete your library.

| ID | Use case | Release |
| --- | --- | --- |
| U1 | Quick song: type a one-line description, tap Generate, get a full song with AI-written lyrics | v1 |
| U2 | Full arrangement: vocals plus hand-picked instruments, each with a role and loudness (lead, background, occasional) | v1 |
| U3 | Own lyrics in any script: paste Devanagari or English lyrics and set language, BPM, key, and duration | v1 |
| U4 | Long-form song: 5 or 10 minutes in any style, for any deity or theme | v1 |
| U5 | Walk away: start a job, lock the iPad, find the finished song in the library later | v1 |
| U6 | Library: browse, play, loop, rename, favourite, delete, and save to Files | v1 |
| U7 | Server status: see whether the Mac is online, busy, and which models are loaded | v1 |
| U8 | Iterate: reopen a past song's settings and seed, change one thing, regenerate | v1 |
| U9 | Presets: save a full setup (vocals, instruments, avoid list, length) and reuse it | v1 |
| U10 | Variations: two takes from one prompt, compared side by side | v1.1 |
| U11 | Cover or restyle: upload a track from Files and regenerate it in a new style | v1.1 |
| U12 | Repaint: regenerate a chosen time range of an existing song | v1.2 |
| U13 | Counted mantra: an exact number of repetitions, such as 108 | v1.1 |

Instrumental-only is simply the "no vocals" choice inside U2, not a separate mode.

### Reference scenarios

These are v1 acceptance tests, not templates. Typical requests are 5- or 10-minute songs in varied styles for different deities, so the builder never assumes a mantra or a repetition count. Scenario 1 is your Shiva mantra example:

- **Prompt:** Deeply peaceful Shiva mantra meditation, soft devotional female vocal, warm and soothing voice, slow chanting, 60 BPM, gentle and consistent rhythm, tanpura drone, subtle shruti box, very soft bansuri in the background, occasional delicate temple bell, spacious spiritual ambience, deep reverb, calm meditative atmosphere, no dramatic buildup, no chorus pop style, no Bollywood style, no EDM, no heavy percussion, no cinematic climax, continuous peaceful chanting suitable for meditation, yoga and relaxation, clear Sanskrit/Hindi pronunciation, devotional and serene.
- **Lyrics:** ॐ नमः शिवाय
- **Length:** 10 minutes, mantra repeated 108 times

Scenario 2 is a 5-minute song in a contrasting style for another deity; you pick it in Milestone 0. Ten minutes is the model's maximum length ([ACE-Step 1.5 README](https://github.com/ace-step/ACE-Step-1.5)). An exact count such as 108 needs loop mode, which moves to v1.1, so v1 renders scenario 1 in one pass with an approximate count.

## Key decision: hosting and connectivity

Decision: host the SPA on Firebase as planned, but expose the Mac over HTTPS with Tailscale Serve. Being on the same Wi-Fi is not enough on its own.

### Why a plain LAN address fails

Firebase serves the page over HTTPS. Browsers treat `fetch()` from an HTTPS page to an `http://` address as blockable mixed content and refuse it ([MDN: Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)). Only loopback addresses such as `localhost` are exempt, and the Mac is not loopback from the iPad's point of view.

Newer browsers can relax this for private IPs and `.local` names, but only after a Local Network Access permission prompt ([MDN: Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)). Do not build on that for iPad Safari; treat it as unavailable unless Milestone 0 proves otherwise.

### Options considered

| Option | How the iPad reaches the Mac | Works in iPad Safari | Effort | Verdict |
| --- | --- | --- | --- | --- |
| Firebase page calls `http://<mac>.local` | HTTPS page to plain HTTP on the LAN | No, blocked as mixed content | Low | Rejected |
| Firebase page calls `https://<mac>.<tailnet>.ts.net` | Tailscale Serve terminates TLS with a real certificate, gateway allows the Firebase origin via CORS | Yes, with the Tailscale app connected | Low | **Chosen** |
| Gateway serves the SPA and API from the same `ts.net` origin | One origin, no CORS | Yes | Lowest | **Built in as the fallback** |
| Plain `http://<mac>.local` page and API, no HTTPS | No mixed content because nothing is HTTPS | Yes, LAN only | Lowest | Development only: no service worker or install-to-Home-Screen offline shell |
| Local CA (mkcert) trusted on the iPad | Self-issued certificate on the LAN | Yes, after installing and trusting a profile | Medium | Fallback if Tailscale is ruled out |
| Public tunnel (Cloudflare Tunnel, Tailscale Funnel) | Public HTTPS URL | Yes | Medium | Not in v1: exposes the Mac to the internet |

### Why Tailscale Serve

- It proxies a local port such as `127.0.0.1:8787` to `https://<device>.<tailnet>.ts.net` for devices on your tailnet only ([Tailscale Serve docs](https://tailscale.com/docs/features/tailscale-serve)).
- It needs HTTPS certificates enabled in the tailnet; the CLI offers to switch that on.
- The gateway can listen on localhost only, so nothing on the Mac is open to the LAN.
- The same URL works at home and away, because the iPad reaches the Mac over the tailnet either way.

### Requirements this decision creates

1. The SPA reads its API base URL from config and never hard-codes a host.
2. The gateway sends CORS headers for the Firebase origin(s) and `localhost` dev only.
3. The gateway also serves the latest SPA build at `/`, so the app still works if the Firebase path hits a browser restriction.
4. The UI detects "Mac unreachable" and tells you to check the Tailscale app, not just "network error".

## System architecture

Three processes on the Mac do all the work; Firebase only hands the iPad a static app.

&#91;embedded content: system architecture · 6 components, 5 connections\]

Every request that carries data goes iPad, then Tailscale Serve, then the gateway. The engine and storage are reachable only from the gateway on localhost.

| Component | Technology | Responsibility | Listens on |
| --- | --- | --- | --- |
| Web app | React, TypeScript, Vite; installable PWA | Builder, queue, library, player, settings | Firebase Hosting, plus `/` on the gateway as fallback |
| Tailscale Serve | Tailscale macOS client | TLS with a real certificate, tailnet-only access | `https://<mac>.<tailnet>.ts.net` |
| Gateway | Python 3.12, FastAPI, SQLite, ffmpeg | Auth, CORS, prompt compiler, job queue, engine adapter, loop builder, library, SSE | `127.0.0.1:8787` |
| ACE-Step engine | `acestep-api` from ACE-Step 1.5 | LM planning, DiT diffusion, VAE decode | `127.0.0.1:8001` |
| Storage | SQLite file and folders under `~/AceStudio/` | Jobs, songs, presets, audio masters, uploads | Local disk |

### Why a gateway instead of calling the engine directly

- The engine reports only three task states (queued or running, succeeded, failed) and returns audio as file paths to download ([ACE-Step API docs](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md)). The gateway turns that into a durable library.
- The engine defaults to two songs per request (`batch_size` 2). The gateway pins it to 1 to save time and memory on the M1.
- The instrument builder, avoid list, and loop mode need logic the engine does not have.
- A versioned contract lets a native iPad app replace the web UI later, and lets you swap the engine (for example to acestep.cpp) without touching clients.

### Generation flow

1. The web app posts a job spec (builder fields, lyrics, length, repeat count) to `/api/v1/jobs`.
2. The gateway validates it, compiles the caption and engine parameters, stores the job, and queues it.
3. One worker submits it to `/release_task` and polls `/query_result`.
4. On success the gateway downloads the audio, runs loop mode if requested, encodes an MP3 for streaming, and records the song.
5. The web app follows progress over SSE and streams the song from the gateway.

## Functional requirements

v1 centres on a builder that turns vocals, instruments, avoid rules, and length into precise engine parameters. Everything else supports that loop. Parameter ranges come from the [ACE-Step API docs](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md).

### Compose: the song builder

| ID | Requirement | Release |
| --- | --- | --- |
| F1 | Style and mood: free-text description plus quick chips (meditative, devotional, calm, uplifting), with an optional deity or theme (Shiva, Krishna, Ganesha, Durga, Hanuman, or free text) and form (bhajan, aarti, kirtan, stotram, chant) | v1 |
| F2 | Vocals: type (none, female, male, duet, choir), character (soft, warm, breathy, powerful), delivery (chant, sing, hum). "None" gives an instrumental | v1 |
| F3 | Instrument palette: add any number of instruments from a searchable catalogue or as free text. Each gets a role (drone, lead, supporting, background, accent) and a level (very soft, soft, present, prominent) | v1 |
| F4 | Accent frequency for one-off sounds such as a temple bell: rare, occasional, regular | v1 |
| F5 | Ambience and dynamics: reverb (dry to deep), space (intimate to spacious), dynamics (steady to building) | v1 |
| F6 | Avoid list: chips and free text (EDM, heavy percussion, pop chorus, cinematic climax). Sent as the LM negative prompt; kept out of the positive caption unless Milestone 0 shows otherwise | v1 |
| F7 | Musical metadata sent as real parameters, not only as text: BPM (30–300), key and scale, time signature, duration (10–600 s), vocal language | v1 |
| F8 | Lyrics editor: full Unicode including Devanagari, section tags such as \[verse\] and \[instrumental\], and a "repeat this line N times" helper | v1 |
| F9 | Caption preview: the compiled caption and parameters update live; an expert toggle lets you edit the raw caption before sending | v1 |
| F10 | Advanced engine options: LM planning on or off, keep the caption verbatim (skip LM rewriting), seed, LM temperature | v1 |
| F11 | Presets: save and load a whole builder state; ship starter presets in contrasting styles, including the Shiva mantra example | v1 |

### Long-form and repetition

| ID | Requirement | Release |
| --- | --- | --- |
| F12 | Single pass from 10 s to 10 minutes, with one-tap 5:00 and 10:00. Above this Mac's LM duration cap, the gateway runs a short LM text pass for lyrics and metadata, then renders with the LM off; the UI says so | v1 |
| F13 | Exact-count loop mode: generate a unit whose lyrics hold exactly k repetitions, preview and approve it, then loop it N ÷ k times (108 = 12 × 9). The UI offers only k values that divide N and shows the final length | v1.1 |
| F14 | Seamless joins for loop mode: equal-power crossfade at each loop point (1–3 s, adjustable), plus optional fade-in and fade-out | v1.1 |

### Jobs and queue

| ID | Requirement | Release |
| --- | --- | --- |
| F15 | Submitting creates a queued job at once; the M1 runs one job at a time | v1 |
| F16 | Queue view: position, stage (compiling, generating, looping, encoding), elapsed time, estimated time left, cancel for queued jobs | v1 |
| F17 | Live progress over SSE, with polling every 5 s as fallback | v1 |
| F18 | Jobs survive iPad sleep, tab close, and gateway restarts; unfinished engine tasks are re-polled or marked failed with a Retry button | v1 |
| F19 | "Song ready" notification via Web Push to the Home Screen app | v1.1 |

### Library and playback

| ID | Requirement | Release |
| --- | --- | --- |
| F20 | Library: title, created time, duration, preset, favourite; search and filter | v1 |
| F21 | Player: seek, loop, and keep playing when the iPad locks; audio served with HTTP range support | v1 |
| F22 | Download and share: MP3 for sharing, FLAC master on request; share sheet to Files and other apps | v1 |
| F23 | Song detail: full builder state, lyrics, seed, engine info; actions Regenerate (same seed), Variation (new seed), Edit and regenerate | v1 |
| F24 | Rename, delete, and a storage-used indicator | v1 |

### Server and settings

| ID | Requirement | Release |
| --- | --- | --- |
| F25 | Status panel: Mac reachable, engine health, loaded models, queue depth, free disk | v1 |
| F26 | Pairing: enter the gateway URL and owner token once; stored on the iPad | v1 |
| F27 | QR-code pairing shown on the gateway's status page | v1.1 |

### Later

| ID | Requirement | Release |
| --- | --- | --- |
| F28 | Cover and restyle: upload a track and regenerate it in a new style (the engine accepts uploaded source audio) | v1.1 |
| F29 | Two-take variations compared side by side, memory permitting | v1.1 |
| F30 | Repaint a chosen time range of an existing song | v1.2 |

### How the Shiva mantra example compiles

| Builder field | Example value | Engine parameter |
| --- | --- | --- |
| Theme and form | Shiva; mantra chant | `prompt` |
| Style and mood | Deeply peaceful Shiva mantra meditation; calm, devotional, serene | `prompt` |
| Vocals | Female; soft, warm, soothing; slow chanting; clear Sanskrit and Hindi pronunciation | `prompt`, plus `vocal_language` (code chosen in Milestone 0) |
| Tempo | 60 BPM, gentle and consistent rhythm | `bpm` = 60, plus `prompt` |
| Instruments | Tanpura drone; shruti box, subtle; bansuri, very soft, background; temple bell, occasional, delicate | `prompt` |
| Ambience and dynamics | Spacious spiritual ambience, deep reverb, steady with no buildup | `prompt` |
| Avoid | Dramatic buildup, pop chorus, Bollywood style, EDM, heavy percussion, cinematic climax | `lm_negative_prompt` |
| Lyrics | ॐ नमः शिवाय, written out repeatedly | `lyrics` |
| Length | 10 minutes | `audio_duration` = 600, rendered with the LM off after an LM text pass (F12) |

The compiled positive caption for this scenario reads:

```
Deeply peaceful Shiva mantra meditation, soft devotional female vocal, warm and soothing voice, slow chanting, clear Sanskrit and Hindi pronunciation, 60 BPM, gentle consistent rhythm, tanpura drone, subtle shruti box, very soft bansuri in the background, occasional delicate temple bell, spacious spiritual ambience, deep reverb, calm meditative atmosphere, continuous peaceful chanting for meditation, yoga and relaxation, devotional and serene
```

## Gateway API contract

The gateway exposes one versioned JSON API at `/api/v1`. The web app and any future native app use only this, never the engine.

### Conventions

- Base URL `https://<mac>.<tailnet>.ts.net/api/v1`; JSON bodies in UTF-8.
- Every call carries `Authorization: Bearer <owner token>`, except a bare liveness check on `GET /health`.
- `POST /jobs` takes a client-generated `client_job_id`; a repeat returns the existing job instead of a duplicate.
- Errors use one shape: `{"error": {"code": "engine_unavailable", "message": "...", "retryable": true}}`.
- CORS allows only the Firebase origins and `http://localhost:5173` for development.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness; with a token, also engine status, loaded models, queue depth, free disk |
| GET | `/catalog` | Instruments, roles, levels, vocal types, languages, avoid chips, built-in presets |
| POST | `/compile` | Builder spec in, compiled caption and engine parameters out (drives the live preview) |
| POST | `/jobs` | Create a job from a builder spec; returns 202 with the job |
| GET | `/jobs` | List jobs, newest first, filterable by state |
| GET | `/jobs/{id}` | One job: state, timings, time-left estimate, error |
| GET | `/jobs/{id}/events` | SSE stream of that job's updates |
| POST | `/jobs/{id}/cancel` | Cancel a queued or `unit_ready` job; a running engine task is allowed to finish |
| POST | `/jobs/{id}/approve-unit` | Loop mode (v1.1): accept the previewed unit and start looping |
| POST | `/jobs/{id}/regenerate-unit` | Loop mode (v1.1): discard the unit and generate a new one |
| GET | `/songs` | Library list with search and filters |
| GET, PATCH, DELETE | `/songs/{id}` | Read; rename or favourite; delete |
| GET | `/songs/{id}/audio` | Stream MP3 by default, FLAC with `?format=flac`; honours HTTP Range |
| POST | `/songs/{id}/regenerate` | New job from the song's spec, with `seed` set to `same` or `new` |
| GET, POST, PUT, DELETE | `/presets`, `/presets/{id}` | Manage presets |
| POST | `/uploads` | Source audio for cover and restyle (v1.1) |

### Job spec: the Shiva mantra example

```json
{
  "client_job_id": "7f3c1e9a-2b4d-4c1e-9a7f-3c1e9a2b4d4c",
  "title": "Om Namah Shivaya",
  "theme": {"deity": "Shiva", "form": "mantra chant"},
  "style": "Deeply peaceful Shiva mantra meditation",
  "moods": ["calm", "devotional", "serene"],
  "vocals": {
    "type": "female",
    "character": ["soft", "warm", "soothing"],
    "delivery": "chant",
    "notes": "clear Sanskrit and Hindi pronunciation",
    "language": "sa"
  },
  "instruments": [
    {"name": "tanpura", "role": "drone", "level": "present"},
    {"name": "shruti box", "role": "supporting", "level": "soft"},
    {"name": "bansuri", "role": "background", "level": "very soft"},
    {"name": "temple bell", "role": "accent", "level": "soft", "frequency": "occasional"}
  ],
  "ambience": {"reverb": "deep", "space": "spacious", "dynamics": "steady"},
  "avoid": ["dramatic buildup", "pop chorus", "Bollywood style", "EDM", "heavy percussion", "cinematic climax"],
  "music": {"bpm": 60, "key": null, "time_signature": "4"},
  "lyrics": {"text": "ॐ नमः शिवाय", "repeat": 108},
  "length": {"mode": "single", "total_seconds": 600},
  "engine": {"lm": "auto", "keep_caption": true, "seed": null}
}
```

The `vocals.language` code is provisional until Milestone 0 compares `sa`, `hi`, and romanised lyrics. `engine.lm` set to `auto` lets the gateway use the LM text pass plus LM-off render when the length exceeds the cap. `lyrics.repeat` only writes the line out N times; an exact count needs loop mode (v1.1), sent as `"length": {"mode": "loop", "total_seconds": 600, "unit_repeats": 12}`.

### Job lifecycle

&#91;embedded content: job lifecycle · 9 states\]

A single-pass job runs straight from generating to encoding; a loop-mode job (v1.1) stops at `unit_ready` until you approve or regenerate the unit.

### Engine adapter

| Gateway need | Engine call | Notes |
| --- | --- | --- |
| Submit | `POST /release_task` | `batch_size` 1, `inference_steps` 8, `audio_format` flac, `use_cot_caption` false when the caption is kept verbatim |
| Track | `POST /query_result` every 3 s | Status 0 running, 1 succeeded, 2 failed |
| Fetch audio | `GET /v1/audio?path=...` | Copied into the library immediately |
| Estimate time left | `GET /v1/stats` | `avg_job_seconds`, scaled by requested duration from Milestone 0 timings |
| Health and models | `GET /health`, `GET /v1/models` | Shown in the status panel |
| Auth | `Authorization: Bearer` with `ACESTEP_API_KEY` | Only the gateway knows the key |

The engine gives no percentage or cancel for a running task, so the progress shown is an estimate ([ACE-Step API docs](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md)).

## Engine setup on the M1 MacBook Pro

Run the official Python `acestep-api` through the macOS launcher, with the 2B turbo DiT and the 0.6B LM to start. Memory decides everything beyond that.

### Backend

- `start_api_server_macos.sh` sets `ACESTEP_LM_BACKEND=mlx` and `--backend mlx` for native Apple Silicon acceleration ([INSTALL guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INSTALL.md)).
- Core models need about 10 GB of disk. The main bundle holds the VAE, the Qwen3 text encoder, the turbo DiT, and the 1.7B LM; the 0.6B LM is a separate download.
- Fallback engine: [acestep.cpp](https://github.com/ace-step/acestep.vst3) (C++ and GGML with Metal, quantised models) behind the same gateway adapter, if Python proves too slow or too heavy on the M1.

### Length limits by memory tier

The engine caps duration by detected memory and clamps longer requests with a warning ([GPU compatibility guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md)). On every tier from 4 GB to 20 GB the cap is 8 minutes with the LM and 10 minutes without it. Only 24 GB or more allows 10 minutes with the LM.

For a 10-minute song on the M1, the LM therefore has to be off during the render itself. v1 runs a short LM text pass first (caption, lyrics, and metadata, for example through `/format_input`), then renders the full length with the LM off. Five-minute songs keep the LM on throughout. How the engine maps the M1's unified memory to a tier is checked in Milestone 0.

| M1 RAM | DiT | LM | Notes |
| --- | --- | --- | --- |
| 8 GB | 2B turbo | 0.6B, or none | Check in Milestone 0 whether a 10-minute render fits at all |
| 16 GB | 2B turbo | 0.6B default, 1.7B after Milestone 0 | 5-minute songs with the LM on; 10-minute renders with it off |
| 32 GB (M1 Max) | 2B turbo or SFT | 1.7B | Same split; XL turbo worth testing, with offload below 20 GB |

### Engine defaults

| Setting | Value | Why |
| --- | --- | --- |
| DiT model | `acestep-v15-turbo` | 8 steps, fastest usable quality |
| LM model | `acestep-5Hz-lm-0.6B` | Lowest memory with lyric and metadata planning |
| `batch_size` | 1 | The API default is 2 |
| `inference_steps` | 8 | Recommended for turbo |
| `audio_format` | flac | Lossless master; the gateway makes the MP3 |
| `thinking` | on, switched off automatically for single passes above the LM cap | LM codes improve quality |
| `use_cot_caption` | off for presets with a precise caption | Keeps your caption exactly as written |
| Offload flags | off until tested | They target discrete-GPU VRAM; unified memory may not benefit |
| `ACESTEP_QUEUE_WORKERS` | 1 | One generation at a time |

```
ACESTEP_API_HOST=127.0.0.1
ACESTEP_API_PORT=8001
ACESTEP_API_KEY=<long random secret shared only with the gateway>
ACESTEP_CONFIG_PATH=acestep-v15-turbo
ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B
ACESTEP_QUEUE_WORKERS=1
```

The variables at the top of the macOS launcher script can override these; keep the two in agreement.

### Milestone 0 test runs

| Run | Settings | Record |
| --- | --- | --- |
| 60 s and 300 s songs | Scenario 1 caption, LM on | Total time, peak memory |
| 300 s song in a contrasting style | Scenario 2, LM on | Style and instrument adherence |
| 480 s single pass | LM on | Whether it clamps; total time |
| 600 s render | LM text pass, then LM off | Total time; quality against the 480 s LM-on render |
| Lyrics script | Devanagari against romanised lyrics; `vocal_language` sa against hi | Pronunciation |
| Avoid handling | Negations in the caption against `lm_negative_prompt` only | Stray percussion, buildups, pop hooks |

## Non-functional requirements

The iPad must stay responsive while one slow job runs on the Mac, and no prompt, lyric, or audio file may leave your own devices.

| Area | Requirement |
| --- | --- |
| Responsiveness | Builder, library, and navigation respond within 200 ms on the iPad; job submission returns within 1 s |
| Progress freshness | Job state changes reach the iPad within 5 s |
| Generation time | No fixed v1 target; Milestone 0 baselines for 60 s, 300 s, 480 s, and 600 s drive the time-left estimates |
| Playback | Streaming starts within 2 s on home Wi-Fi; seeking works through HTTP Range |
| Durability | Jobs, songs, and presets live in SQLite with write-ahead logging; a crash never loses a finished song |
| Recovery | launchd restarts the gateway and engine; after 3 failed health checks the gateway restarts the engine and fails the running job with Retry |
| Security | Gateway and engine bind to 127.0.0.1; only Tailscale Serve exposes the gateway; a 32-byte owner token on every call; the engine API key is known only to the gateway; Funnel stays off |
| Privacy | Prompts, lyrics, and audio stay on the Mac and iPad; Firebase serves static files only; no analytics or third-party scripts in v1 |
| Storage | FLAC master plus MP3 per song; warn below 10 GB free. A 10-minute track is roughly 115 MB as WAV, 60–80 MB as FLAC, and 14 MB as 192 kbps MP3 (approximate) |
| Compatibility | Current iPadOS Safari, as a tab and installed to the Home Screen; desktop Safari and Chrome for development |
| Accessibility | Touch targets of at least 44 pt, Dynamic Type respected, every control labelled for VoiceOver |
| Observability | JSON logs with rotation under `~/Library/Logs/AceStudio`; per-job timings for compile, generate, loop, and encode; last error shown in the status panel |
| Maintainability | Engine pinned to a known commit; the gateway adapter isolates engine API changes; contract tests run against recorded engine responses |

## UX: screens and interactions

Five screens behind a tab bar, designed for iPad landscape first: Create, Queue, Library, Song, and Server.

| Screen | Purpose | Key elements |
| --- | --- | --- |
| Create | Build and submit a song | Preset picker; panels for Style and mood, Vocals, Instruments, Ambience, Avoid, Music, Lyrics, Length; live caption preview; Generate |
| Queue | Watch and manage jobs | Current job with stage, elapsed time, time left; loop-unit preview with Approve and Regenerate (v1.1); queued jobs with Cancel |
| Library | Find and play songs | Search, filters, favourites; persistent player bar with seek, loop, share |
| Song | Inspect and iterate | Full settings, lyrics, seed, engine info; Regenerate, Variation, Edit and regenerate, Download |
| Server | Check the Mac | Online state, engine health, loaded models, queue depth, free disk; pairing |

### Interaction details

- **Layout:** in landscape the builder takes the left two-thirds, with the caption preview and Generate pinned on the right. Portrait stacks them.
- **Instruments:** a search field with suggestions adds rows. Each row has role and level controls, plus a frequency control for accents. Rows reorder by drag, because order shapes the caption.
- **Vocals:** "None" is the first choice and collapses the other vocal controls, so an instrumental is one tap.
- **Avoid:** toggle chips and add your own; the preview shows exactly where each one is sent.
- **Length:** one tap for 5:00 or 10:00, or any length from 10 s to 10:00. Above the LM cap the panel says the render runs with the LM off. Exact count (loop mode) arrives in v1.1.
- **Lyrics:** accepts Devanagari from the Hindi keyboard or paste. "Repeat line" asks for a count; in loop mode (v1.1) it fills k lines automatically.
- **Mac unreachable:** a banner asks whether Tailscale is connected and offers Retry. The builder keeps working; nothing is submitted until the Mac answers.
- **Long jobs:** the Queue tab shows a badge while a job runs. Leaving the app is safe, and reopening it lands on the finished song.

## Headless Mac runbook

The M1 must boot, connect, and serve with nobody at it. One session with an external display sets that up; after that everything runs over SSH.

1. **One-time access.** Attach an external display and keyboard over USB-C or HDMI. In System Settings → General → Sharing, turn on Remote Login (SSH) and Screen Sharing, and note the Mac's name.
2. **Boot without a login.** Run services as LaunchDaemons with a `UserName` key, so they start before anyone logs in. With FileVault on, the disk stays locked after a reboot: either turn FileVault off on this server, or reboot only with `sudo fdesetup authrestart`.
3. **Power and sleep.** Keep it plugged in and run `sudo pmset -a sleep 0 disksleep 0 displaysleep 0`. Leave the lid open for airflow; use `sudo pmset -a disablesleep 1` only if the lid must close.
4. **Tools.** Install the Xcode command-line tools, Homebrew, uv, git, and ffmpeg. Install Tailscale with `brew install tailscale`: the open-source daemon runs at boot without a login.
5. **Engine.** Clone ACE-Step 1.5, run `uv sync`, then `uv run acestep-download` and `uv run acestep-download --model acestep-5Hz-lm-0.6B`. Write the `.env` from the engine section, set `CHECK_UPDATE="false"` in the macOS launcher, and pin the commit.
6. **Gateway.** Clone the gateway to `~/AceStudio/gateway`. Configure the engine URL and key, owner token, CORS origins, and storage path, then run its migrations.
7. **Services.** Create `local.acestudio.engine` and `local.acestudio.gateway` LaunchDaemons with `RunAtLoad`, `KeepAlive`, `UserName`, and log paths. Load each with `sudo launchctl bootstrap system <plist>`.
8. **Tailscale.** Start the daemon with `sudo brew services start tailscale`, run `tailscale up`, and enable MagicDNS and HTTPS certificates. Then run `tailscale serve --bg 8787` and note the `ts.net` URL.
9. **iPad.** Install Tailscale from the App Store and join the same tailnet. Open the web app, pair it with the URL and owner token, and Add to Home Screen.
10. **Health checks.** From any tailnet device, `curl https://<mac>.<tailnet>.ts.net/api/v1/health`. Logs live in `~/Library/Logs/AceStudio`.
11. **Updates.** Engine: test a new commit against the Milestone 0 runs before switching. Gateway: `git pull`, then `sudo launchctl kickstart -k system/local.acestudio.gateway`. Web app: `firebase deploy`.
12. **Backups.** Nightly `sqlite3 .backup` of the database; weekly rsync of `~/AceStudio/audio` to an external drive or NAS.

## Milestones and delivery plan

v1 is Milestones 0 to 3. Milestone 0 is a spike that settles length, pronunciation, and the avoid list before any UI work.

&#91;embedded content: delivery roadmap · 5 milestones, 4 gates\]

Each gate is a test you run yourself; the next milestone starts only when it passes.

### Milestone 0 checklist

- [ ] Engine serving on `127.0.0.1:8001` with an API key
- [ ] Scenario 1 rendered at 60 s, 300 s, and 480 s with the LM, and at 600 s through the LM text pass plus LM-off render
- [ ] Scenario 2 chosen: a 5-minute song in a contrasting style for another deity, rendered and reviewed
- [ ] Lyrics script and `vocal_language` code chosen for Sanskrit and Hindi lyrics
- [ ] Avoid-list strategy chosen: negative prompt only, or caption as well
- [ ] Memory tier the engine detects on the M1 read from its log
- [ ] iPad Safari check: a Firebase-hosted test page can fetch the `ts.net` URL

## Risks, open questions, and decisions

The biggest risk is length: 10-minute songs exceed the M1's LM cap, so Milestone 0 must show that the LM-off render sounds good enough.

### Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A 10-minute render with the LM on exceeds the M1's tier cap (8 minutes), or runs too slowly | Clamped length, long waits | LM text pass, then an LM-off render; acestep.cpp as the fallback engine |
| LM-off renders sound less planned than LM-on ones | Weaker structure in 10-minute songs | Milestone 0 A/B against a 480 s LM-on render; offer 8 minutes with the LM as an alternative |
| Weak Sanskrit or Hindi pronunciation | Unclear lyrics | Milestone 0 compares Devanagari with romanised lyrics and language codes; presets store the winner |
| Negations in the caption are ignored, or even pull toward the named style | EDM or percussion creeps in | Avoid list goes to the negative prompt; the caption stays positive; Milestone 0 A/B test |
| Styles and deities blur into one generic sound | Songs feel interchangeable | Theme, form, and instrument roles compile into distinct captions; starter presets per style; scenario 2 tests the contrast |
| An exact repetition count cannot be held in one pass | Counted mantras miss their number | Loop mode with an approved unit in v1.1; v1 labels counts as approximate |
| iPad Safari blocks or prompts when a public page calls a tailnet address | The app cannot reach the Mac | Same-origin fallback served by the gateway |
| Engine crashes or memory creep over many runs | Stuck queue | launchd KeepAlive, health watchdog, persisted jobs with Retry |
| Heat and throttling during long runs | Slower jobs, possible shutdown | Lid open, hard surface, one job at a time |
| Fast-moving upstream (over 1,400 commits) | Adapter breaks after an update | Pinned commit, adapter layer, contract tests, Milestone 0 runs before upgrading |
| Rights for published tracks | Legal exposure if you release music | Code is MIT; confirm the model weights' licence on Hugging Face before commercial use; disclose AI involvement |

### Open questions

- [ ] How much RAM does the M1 have? It sets the default models.
- [ ] Which deities, forms, and styles should the starter presets cover?
- [ ] Which `vocal_language` code suits Sanskrit lyrics: `sa`, `hi`, or unset?
- [ ] Which memory tier does the engine detect on the M1's unified memory?
- [ ] Is a 10-minute LM-off render good enough, or is 8 minutes with the LM the better default?
- [ ] Does `acestep-api` return lyric timestamps, so the gateway could count repetitions automatically?
- [ ] Should trusted guests get access in v1.1, and with what limits?
- [ ] After Milestone 2, keep Firebase Hosting or move entirely to the gateway-served app?

### Decisions log

| Date | Decision | Status | Why |
| --- | --- | --- | --- |
| 2026-09-27 | The M1 MacBook Pro is the inference server; the iPad is a thin client | Decided | The iPad cannot run the models comfortably |
| 2026-09-27 | The web app is hosted on Firebase | Decided | Your choice: static hosting with easy deploys |
| 2026-09-27 | Vocals plus configurable instruments are core; instrumental is one option | Decided | Your requirement |
| 2026-09-27 | v1 targets 5- and 10-minute songs in any style, for any deity; the Shiva mantra is one example | Decided | Your clarification |
| 2026-09-27 | The gateway is exposed only through Tailscale Serve over HTTPS | Proposed | Mixed-content blocking rules out plain LAN HTTP |
| 2026-09-27 | Python `acestep-api` with MLX is the v1 engine | Proposed | Async task API, API key, full feature set |
| 2026-09-27 | 10-minute songs render with the LM off after an LM text pass; loop mode moves to v1.1 | Proposed | The M1's tier caps LM-on renders at 8 minutes, and counted mantras are occasional |

## Sources

- [ACE-Step 1.5 README](https://github.com/ace-step/ACE-Step-1.5)
- [ACE-Step API docs](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md)
- [ACE-Step installation guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INSTALL.md)
- [ACE-Step GPU compatibility guide](https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md)
- [acestep.vst3 and acestep.cpp README](https://github.com/ace-step/acestep.vst3)
- [MDN: Mixed content](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content)
- [MDN: Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)
- [Tailscale Serve docs](https://tailscale.com/docs/features/tailscale-serve)
