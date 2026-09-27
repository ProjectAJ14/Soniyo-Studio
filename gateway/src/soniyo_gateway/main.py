"""App factory, lifespan (db, presets, recovery, worker, watchdog), CORS, static SPA."""

import asyncio
import contextlib
import json
import logging
import logging.handlers
import time
from collections.abc import AsyncIterator
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import __version__, db, errors, library, worker
from .config import Settings
from .engine import Engine
from .events import Hub
from .repo import Repo
from .routes import catalog, compile, health, jobs, presets, songs

log = logging.getLogger("soniyo_gateway")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def setup_logging(log_dir: Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = JsonFormatter()
    file = logging.handlers.RotatingFileHandler(
        log_dir / "gateway.log", maxBytes=5 * 1024**2, backupCount=5, encoding="utf-8"
    )
    stderr = logging.StreamHandler()
    root = logging.getLogger()
    root.handlers[:] = []
    for h in (file, stderr):
        h.setFormatter(fmt)
        root.addHandler(h)
    root.setLevel(logging.INFO)


def build_engine(settings: Settings) -> Engine:
    if settings.engine == "fake":
        from .engine.fake import FakeEngine

        return FakeEngine(settings.fake_seconds, settings.data_dir / "fake-engine")
    if settings.engine == "acestep":
        from .engine.acestep import AceStepEngine

        return AceStepEngine(settings.engine_url, settings.engine_key)
    raise SystemExit(f"SONIYO_ENGINE must be 'acestep' or 'fake', not {settings.engine!r}")


def create_app(settings: Settings, engine: Engine | None = None) -> FastAPI:
    engine = engine or build_engine(settings)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        conn = db.connect(settings.db_path)
        settings.audio_dir.mkdir(parents=True, exist_ok=True)
        rt = worker.Runtime(settings=settings, repo=Repo(conn, Hub()), engine=engine)
        app.state.rt = rt
        library.seed_builtin_presets(rt.repo)
        resume = worker.recover(rt.repo)
        tasks = [
            asyncio.create_task(worker.run(rt, resume), name="worker"),
            asyncio.create_task(worker.watchdog(rt), name="watchdog"),
        ]
        log.info("gateway started engine=%s data_dir=%s", settings.engine, settings.data_dir)
        try:
            yield
        finally:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await engine.aclose()
            conn.close()
            log.info("gateway stopped")

    app = FastAPI(title="Soniyo gateway", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)  # fmt: skip

    @app.middleware("http")
    async def access_log(request: Request, call_next):  # noqa: ANN001, ANN202
        t = time.monotonic()
        try:
            response = await call_next(request)
        except Exception as exc:  # noqa: BLE001 - becomes the standard internal error body
            response = errors.unhandled(request, exc)
        # path only: the query string may carry ?token=
        log.info("%s %s %s %.0fms", request.method, request.url.path, response.status_code,
                 (time.monotonic() - t) * 1000)  # fmt: skip
        return response

    # Added last = outermost, so error responses from the layer above also carry CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "Range"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
    )
    errors.install(app)
    for r in (health, catalog, compile, jobs, songs, presets):
        app.include_router(r.router, prefix="/api/v1")
    if settings.web_dist and settings.web_dist.is_dir():
        app.mount("/", StaticFiles(directory=settings.web_dist, html=True), name="web")
    return app


def run() -> None:
    settings = Settings.from_env()
    setup_logging(settings.log_dir)
    uvicorn.run(
        create_app(settings),
        host=settings.host,
        port=settings.port,
        access_log=False,  # our middleware logs without query strings (tokens)
        log_config=None,
    )
