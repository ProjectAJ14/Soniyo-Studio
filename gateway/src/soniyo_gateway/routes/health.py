import shutil

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .. import __version__
from ..auth import token_ok
from ..schemas import Disk, EngineHealth, Health
from ..worker import ACTIVE
from . import Rt

router = APIRouter()


@router.get("/health")
def health(request: Request, rt: Rt) -> JSONResponse:
    if not token_ok(request):  # bare: nothing beyond "the gateway is up"
        return JSONResponse(Health(version=__version__).model_dump(include={"status", "version"}))
    s, h = rt.settings, rt.health
    s.data_dir.mkdir(parents=True, exist_ok=True)
    du = shutil.disk_usage(s.data_dir)
    running = [j for j in rt.repo.jobs_in_states(list(ACTIVE)) if j["state"] != "queued"]
    full = Health(
        version=__version__,
        engine=EngineHealth(reachable=h.reachable, status=h.status, models=h.models,
                            last_error=h.last_error),
        queue_depth=len(rt.repo.queued_ids()),
        running_job_id=running[0]["id"] if running else None,
        disk=Disk(free_bytes=du.free, total_bytes=du.total,
                  used_by_library_bytes=rt.repo.library_bytes(),
                  low=du.free < s.low_disk_bytes),
    )  # fmt: skip
    return JSONResponse(full.model_dump())
