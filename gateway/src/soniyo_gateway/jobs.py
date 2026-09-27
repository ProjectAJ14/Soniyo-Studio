"""Job service: create (idempotent), list, cancel, retry, and the Job wire snapshot."""

import sqlite3
import uuid
from datetime import UTC, datetime

from .db import now
from .errors import ApiError
from .repo import Repo
from .schemas import TERMINAL_STATES, BuilderSpec, Job

DEFAULT_FACTOR = 1.0  # generate seconds per second of audio, before any history exists


def _ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def title_for(spec: BuilderSpec) -> str:
    return spec.title.strip() or spec.style.strip()[:60] or "Untitled"


def factor(repo: Repo) -> float:
    """Generate seconds per second of audio: from succeeded-job history, else 1."""
    return repo.generate_seconds_per_audio_second() or DEFAULT_FACTOR


def _elapsed(d: dict) -> float | None:
    if not d["started_at"]:
        return None
    end = _ts(d["finished_at"]) if d["finished_at"] else datetime.now(UTC)
    return max(0.0, (end - _ts(d["started_at"])).total_seconds())


def queue_view(repo: Repo) -> dict[str, tuple[int, float]]:
    """id -> (position, estimate_seconds_left) for every unfinished job, in one query and one
    pass: running first, then queued in order. A queued job waits for the running job's
    remainder plus the render of every queued job ahead of it, then its own."""
    f, out, pos, wait = factor(repo), {}, 0, 0.0
    for d in repo.unfinished_jobs():
        render = f * d["spec"].length.total_seconds
        if d["state"] == "queued":
            pos += 1
            wait += render
            out[d["id"]] = (pos, wait)
        else:
            left = max(0.0, render - (_elapsed(d) or 0.0))
            wait += left
            out[d["id"]] = (0, left)
    return out


def to_schema(d: dict, view: dict[str, tuple[int, float]]) -> Job:
    position, estimate = view.get(d["id"], (None, None))
    if d["state"] in TERMINAL_STATES:
        position, estimate = None, None
    return Job(**d, position=position, elapsed_seconds=_elapsed(d),
               estimate_seconds_left=estimate)  # fmt: skip


def get(repo: Repo, job_id: str) -> Job:
    d = repo.get_job(job_id)
    if d is None:
        raise ApiError("not_found", "No such job.")
    return to_schema(d, queue_view(repo))


def list_jobs(repo: Repo, states: list[str] | None, limit: int) -> list[Job]:
    view = queue_view(repo)
    return [to_schema(d, view) for d in repo.list_jobs(states, limit)]


def create(repo: Repo, spec: BuilderSpec) -> tuple[Job, bool]:
    """Returns (job, created). A repeated client_job_id returns the existing job."""
    cid = (spec.client_job_id or "").strip()
    if not cid or len(cid) > 100:
        raise ApiError("validation_failed", "client_job_id: required, at most 100 characters")
    existing = repo.get_job_by_client_id(cid)
    if existing:
        return get(repo, existing["id"]), False
    job_id = uuid.uuid4().hex
    spec = spec.model_copy(update={"client_job_id": cid})
    try:
        repo.insert_job(job_id, cid, title_for(spec), spec)
    except sqlite3.IntegrityError:  # a concurrent retry with the same id won the insert
        existing = repo.get_job_by_client_id(cid)
        if existing is None:
            raise
        return get(repo, existing["id"]), False
    return get(repo, job_id), True


def cancel(repo: Repo, job_id: str) -> Job:
    get(repo, job_id)  # 404 first
    if not repo.update_job(job_id, only_from=("queued",), state="cancelled", finished_at=now()):
        raise ApiError("conflict", "Only queued jobs can be cancelled.")
    return get(repo, job_id)


def retry(repo: Repo, job_id: str) -> Job:
    old = get(repo, job_id)
    if old.state != "failed":
        raise ApiError("conflict", "Only failed jobs can be retried.")
    return resubmit(repo, old.spec)


def resubmit(repo: Repo, spec: BuilderSpec) -> Job:
    job, _ = create(repo, spec.model_copy(update={"client_job_id": uuid.uuid4().hex}))
    return job
