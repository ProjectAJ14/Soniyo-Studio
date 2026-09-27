"""Single consumer: compile -> engine -> fetch -> encode -> song. Also startup recovery (F18)
and the engine health watchdog. The only caller of the Engine protocol."""

import asyncio
import contextlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from . import audio, jobs
from .compiler import compile_spec
from .config import Settings
from .db import now
from .engine import Engine, EngineResult, Formatted
from .errors import ApiError
from .repo import Repo
from .schemas import EngineParams, ErrorBody, Song

log = logging.getLogger(__name__)
ACTIVE = ("queued", "compiling", "generating", "unit_ready", "looping", "encoding")
MIN_RENDER_SECONDS = 600.0  # _poll gives up after max(this, 4x the expected render time)


@dataclass
class EngineStatus:
    status: Literal["ok", "down", "unknown"] = "unknown"
    reachable: bool = False
    models: list[str] = field(default_factory=list)
    last_error: str | None = None
    failures: int = 0


@dataclass
class Runtime:
    settings: Settings
    repo: Repo
    engine: Engine
    health: EngineStatus = field(default_factory=EngineStatus)
    current: asyncio.Task | None = None
    abort: ApiError | None = None  # set by the watchdog before cancelling `current`


# ---- recovery -----------------------------------------------------------------------------


def recover(repo: Repo, audio_dir: Path) -> list[str]:
    """Requeue compiling (and encoding without a task); re-poll generating/encoding jobs that
    have an engine task, so finished audio is fetched, not re-rendered; fail the rest; delete
    audio files no song owns (a crashed attempt's leftovers). Returns the ids to re-poll."""
    for d in repo.jobs_in_states(["compiling", "encoding"]):
        if d["state"] == "encoding" and d["engine_task_id"]:
            repo.update_job(d["id"], state="generating")
        else:
            repo.update_job(d["id"], state="queued", started_at=None)
    owned = repo.song_file_names()
    for f in audio_dir.glob("*") if audio_dir.is_dir() else ():
        if f.is_file() and f.name not in owned:
            log.warning("removing orphaned audio file %s", f.name)
            f.unlink(missing_ok=True)
    resume = []
    for d in repo.jobs_in_states(["generating", "unit_ready", "looping"]):
        if d["state"] == "generating" and d["engine_task_id"]:
            resume.append(d["id"])
        else:
            _fail(repo, d["id"], d["timings"], ApiError(
                "internal", "Interrupted by a gateway restart before the engine took it.", True
            ))  # fmt: skip
    return resume


# ---- worker loop --------------------------------------------------------------------------


async def run(rt: Runtime, resume: list[str]) -> None:
    for job_id in resume:
        try:
            d = rt.repo.get_job(job_id)
            if d and d["state"] == "generating":
                await _run_one(rt, job_id, resume_task=d["engine_task_id"])
        except Exception:
            log.exception("worker resume failed job=%s", job_id)
    wake = rt.repo.hub.wake
    while True:
        try:
            await _next(rt, wake)
        except Exception:  # e.g. the DB fails inside a job's error handler: keep consuming
            log.exception("worker iteration failed")
            await asyncio.sleep(1)


async def _next(rt: Runtime, wake: asyncio.Event) -> None:
    wake.clear()
    # Only a confirmed-healthy engine takes work: "unknown" at boot while models load, and
    # "ok"->"down" in progress, would fail the job. The watchdog wakes us when it turns ok.
    ids = rt.repo.queued_ids() if rt.health.status == "ok" else []
    if not ids:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(wake.wait(), 1.0)
        return
    if rt.repo.update_job(ids[0], only_from=("queued",), state="compiling", started_at=now()):
        await _run_one(rt, ids[0])


async def _run_one(rt: Runtime, job_id: str, resume_task: str | None = None) -> None:
    rt.abort = None
    rt.current = asyncio.create_task(_process(rt, job_id, resume_task))
    try:
        await rt.current
    except asyncio.CancelledError:
        rt.current.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await rt.current
        raise
    finally:
        rt.current = None
        rt.abort = None


async def _process(rt: Runtime, job_id: str, resume_task: str | None) -> None:
    repo, engine, s = rt.repo, rt.engine, rt.settings
    job = repo.get_job(job_id)
    assert job is not None
    spec, timings = job["spec"], dict(job["timings"])
    files: list[Path] = []
    task_id = resume_task
    try:
        if resume_task is None:
            t = time.monotonic()
            compiled = compile_spec(spec, lm_cap_seconds=s.lm_cap_seconds)
            timings["compile"] = round(time.monotonic() - t, 3)
            repo.update_job(job_id, state="generating", compiled=compiled, timings=timings)
            t = time.monotonic()
            params = compiled.params
            if compiled.plan.lm_text_pass:
                try:
                    params = _merge(params, await engine.format_input(params),
                                    keep_caption=spec.engine.keep_caption)  # fmt: skip
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.warning("lm text pass failed job=%s: %s", job_id, e)
                    compiled.notes.append(
                        "The LM text pass failed, so this song was rendered with the LM off "
                        "from the compiled caption and lyrics."
                    )
            if compiled.plan.lm_off_render:
                params = params.model_copy(update={"thinking": False, "use_cot_caption": False})
            compiled = compiled.model_copy(update={"params": params})
            task_id = await engine.submit(params)
            repo.update_job(job_id, compiled=compiled, engine_task_id=task_id)
        else:
            compiled, t = job["compiled"], time.monotonic()
            params = compiled.params

        factor = repo.generate_seconds_per_audio_second() or jobs.DEFAULT_FACTOR
        budget = max(MIN_RENDER_SECONDS, 4 * factor * spec.length.total_seconds)
        result = await _poll(rt, task_id, time.monotonic() + budget)
        if result.status == "failed":
            raise ApiError("internal", f"The engine could not render this song: {result.error}")
        if not result.audio_path:
            raise ApiError("internal", "The engine finished but returned no audio file.", False)
        timings["generate"] = round(time.monotonic() - t, 3)

        song_id = uuid.uuid4().hex
        s.audio_dir.mkdir(parents=True, exist_ok=True)
        flac, mp3 = s.audio_dir / f"{song_id}.flac", s.audio_dir / f"{song_id}.mp3"
        files += [flac, mp3]
        await engine.fetch_audio(result.audio_path, flac)
        repo.update_job(job_id, state="encoding", timings=timings)

        t = time.monotonic()
        await audio.encode_mp3(flac, mp3)
        duration = await audio.probe_duration(flac)
        timings["encode"] = round(time.monotonic() - t, 3)

        seed = result.seed
        if seed is None and params.seed >= 0:
            seed = params.seed
        song = Song(
            id=song_id, job_id=job_id, title=job["title"], created_at=now(),
            duration_seconds=duration, favourite=False, preset_id=None, spec=spec,
            compiled=compiled, seed=seed,
            engine_info=result.info or {"dit": s.dit_model, "lm": s.lm_model},
            size_bytes=flac.stat().st_size + mp3.stat().st_size,
        )  # fmt: skip
        repo.finish_job(job_id, song, str(flac), str(mp3), timings)  # one transaction
        files = []  # the library owns them now
        log.info("job succeeded job=%s song=%s timings=%s", job_id, song_id, timings)
    except asyncio.CancelledError:
        if rt.abort is None:
            raise  # shutdown: leave the state for recovery
        _fail(repo, job_id, timings, rt.abort)
    except ApiError as e:
        if e.code == "engine_unavailable" and task_id is None:
            # The engine never took it: back to the front of the queue, not failed (F18).
            log.warning("engine unavailable before submit, requeued job=%s: %s", job_id, e.message)
            repo.update_job(job_id, only_from=ACTIVE, state="queued", started_at=None)
            await asyncio.sleep(rt.settings.engine_poll_seconds)  # no hot loop if it stays down
        else:
            _fail(repo, job_id, timings, e)
    except Exception:
        log.exception("job crashed job=%s", job_id)
        _fail(repo, job_id, timings, ApiError("internal", "The gateway hit an unexpected error."))
    finally:
        for f in files:
            f.unlink(missing_ok=True)


def _fail(repo: Repo, job_id: str, timings: dict, e: ApiError) -> None:
    log.warning("job failed job=%s code=%s msg=%s", job_id, e.code, e.message)
    err = ErrorBody(code=e.code, message=e.message, retryable=e.retryable)
    repo.update_job(job_id, only_from=ACTIVE, state="failed", error=err, finished_at=now(),
                    timings=timings)  # fmt: skip


async def _poll(rt: Runtime, task_id: str, deadline: float) -> EngineResult:
    while True:
        if time.monotonic() > deadline:
            raise ApiError("engine_unavailable", "The engine took too long; retry this job.")
        try:
            r = await rt.engine.query(task_id)
        except ApiError as e:
            if e.code != "engine_unavailable":
                raise
            log.warning("engine poll failed task=%s: %s", task_id, e.message)  # watchdog decides
        else:
            if r.status != "running":
                return r
        await asyncio.sleep(rt.settings.engine_poll_seconds)


def _merge(p: EngineParams, f: Formatted, *, keep_caption: bool) -> EngineParams:
    """LM text pass fills what the user left open; user lyrics and metadata always win."""
    return p.model_copy(update={
        "prompt": p.prompt if keep_caption or not f.caption else f.caption,
        "lyrics": p.lyrics or f.lyrics,
        "bpm": p.bpm or f.bpm,
        "key_scale": p.key_scale or f.key_scale,
        "time_signature": p.time_signature or f.time_signature,
        "vocal_language": p.vocal_language or f.vocal_language,
    })  # fmt: skip


# ---- watchdog -----------------------------------------------------------------------------


async def watchdog(rt: Runtime) -> None:
    s, h = rt.settings, rt.health
    while True:
        try:
            ok, models, err = await rt.engine.health()
        except Exception as e:  # the adapter should not raise, but never kill the watchdog
            ok, models, err = False, [], f"{type(e).__name__}: {e}"
        h.reachable = ok
        if ok:
            if h.status != "ok":
                log.info("engine healthy models=%s", models)
                rt.repo.hub.wake.set()
            h.status, h.models, h.failures = "ok", models, 0
        else:
            h.failures += 1
            h.last_error = err
            log.warning("engine health failed %d/%d: %s", h.failures, s.health_fail_threshold, err)
            if h.failures >= s.health_fail_threshold:
                h.status, h.failures = "down", 0
                _abort_running(rt)
                await _restart_engine(s.engine_restart_cmd)
        await asyncio.sleep(s.health_poll_seconds)


def _abort_running(rt: Runtime) -> None:
    if rt.current is None or rt.current.done():
        return
    rt.abort = ApiError(
        "engine_unavailable", "The engine stopped responding, so this job was stopped. Retry it."
    )
    rt.current.cancel()


async def _restart_engine(cmd: str) -> None:
    if not cmd:
        return
    log.warning("running engine restart command")  # the command itself may hold secrets
    try:
        proc = await asyncio.create_subprocess_shell(cmd)
        rc = await asyncio.wait_for(proc.wait(), 120)
        log.warning("engine restart command exited rc=%s", rc)
    except (OSError, TimeoutError) as e:
        log.error("engine restart command failed: %s", e)
