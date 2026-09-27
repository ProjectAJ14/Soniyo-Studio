import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import StreamingResponse

from .. import jobs
from ..auth import require_token, require_token_or_query
from ..errors import ApiError
from ..schemas import TERMINAL_STATES, BuilderSpec, Job, JobList
from . import Rt

router = APIRouter(prefix="/jobs")
authed = [Depends(require_token)]
KEEPALIVE_SECONDS = 15.0
_STATES = {"queued", "compiling", "generating", "unit_ready", "looping", "encoding",
           "succeeded", "failed", "cancelled"}  # fmt: skip


@router.post("", status_code=202, dependencies=authed)
def create_job(spec: BuilderSpec, rt: Rt, response: Response) -> Job:
    job, created = jobs.create(rt.repo, spec)
    if not created:
        response.status_code = 200
    return job


@router.get("", dependencies=authed)
def list_jobs(rt: Rt, state: str = "", limit: int = Query(50, ge=1, le=500)) -> JobList:
    states = [s.strip() for s in state.split(",") if s.strip()]
    if bad := [s for s in states if s not in _STATES]:
        raise ApiError("validation_failed", f"state: unknown {', '.join(bad)}")
    return JobList(items=jobs.list_jobs(rt.repo, states or None, limit))


@router.get("/{job_id}", dependencies=authed)
def get_job(job_id: str, rt: Rt) -> Job:
    return jobs.get(rt.repo, job_id)


@router.post("/{job_id}/cancel", dependencies=authed)
def cancel_job(job_id: str, rt: Rt) -> Job:
    return jobs.cancel(rt.repo, job_id)


@router.post("/{job_id}/retry", status_code=202, dependencies=authed)
def retry_job(job_id: str, rt: Rt) -> Job:
    return jobs.retry(rt.repo, job_id)


@router.get("/{job_id}/events", dependencies=[Depends(require_token_or_query)])
async def job_events(job_id: str, rt: Rt) -> StreamingResponse:
    jobs.get(rt.repo, job_id)  # 404 before the stream starts
    hub = rt.repo.hub

    async def stream() -> AsyncIterator[str]:
        queue = hub.subscribe()  # before the first read, so no change slips between
        try:
            last = None
            while True:
                job = jobs.get(rt.repo, job_id)
                data = job.model_dump_json()
                if data != last:
                    yield f"event: job\ndata: {data}\n\n"
                    last = data
                if job.state in TERMINAL_STATES:
                    return
                try:
                    await asyncio.wait_for(queue.get(), KEEPALIVE_SECONDS)
                except TimeoutError:
                    yield ": keepalive\n\n"
                while not queue.empty():  # coalesce bursts into one snapshot
                    queue.get_nowait()
        finally:
            hub.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
