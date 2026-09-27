"""Job service: create (idempotent), list, cancel, retry, and the Job wire snapshot."""

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


def to_schema(repo: Repo, d: dict, *, queued: list[str] | None = None,
              factor: float | None = None) -> Job:  # fmt: skip
    state = d["state"]
    if state in TERMINAL_STATES:
        position = None
    elif state == "queued":
        queued = repo.queued_ids() if queued is None else queued
        position = queued.index(d["id"]) + 1 if d["id"] in queued else None
    else:
        position = 0
    elapsed = None
    if d["started_at"]:
        end = _ts(d["finished_at"]) if d["finished_at"] else datetime.now(UTC)
        elapsed = max(0.0, (end - _ts(d["started_at"])).total_seconds())
    estimate = None
    if state not in TERMINAL_STATES:
        if factor is None:
            factor = repo.generate_seconds_per_audio_second() or DEFAULT_FACTOR
        estimate = max(0.0, factor * d["spec"].length.total_seconds - (elapsed or 0.0))
    return Job(**d, position=position, elapsed_seconds=elapsed, estimate_seconds_left=estimate)


def get(repo: Repo, job_id: str) -> Job:
    d = repo.get_job(job_id)
    if d is None:
        raise ApiError("not_found", "No such job.")
    return to_schema(repo, d)


def list_jobs(repo: Repo, states: list[str] | None, limit: int) -> list[Job]:
    queued = repo.queued_ids()
    factor = repo.generate_seconds_per_audio_second() or DEFAULT_FACTOR
    rows = repo.list_jobs(states, limit)
    return [to_schema(repo, d, queued=queued, factor=factor) for d in rows]


def create(repo: Repo, spec: BuilderSpec) -> tuple[Job, bool]:
    """Returns (job, created). A repeated client_job_id returns the existing job."""
    cid = (spec.client_job_id or "").strip()
    if not cid or len(cid) > 100:
        raise ApiError("validation_failed", "client_job_id: required, at most 100 characters")
    existing = repo.get_job_by_client_id(cid)
    if existing:
        return to_schema(repo, existing), False
    job_id = uuid.uuid4().hex
    spec = spec.model_copy(update={"client_job_id": cid})
    repo.insert_job(job_id, cid, title_for(spec), spec)
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
