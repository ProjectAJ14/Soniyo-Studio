import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from soniyo_gateway.config import Settings
from soniyo_gateway.engine.fake import FakeEngine
from soniyo_gateway.main import create_app

TOKEN = "t" * 40
ORIGIN = "http://localhost:5173"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        owner_token=TOKEN,
        data_dir=tmp_path / "data",
        engine="fake",
        engine_poll_seconds=0.02,
        fake_seconds=0.2,
        health_poll_seconds=0.05,
        health_fail_threshold=2,
        log_dir=tmp_path / "logs",
        cors_origins=[ORIGIN],
    )


@pytest.fixture
def fake(settings: Settings) -> FakeEngine:
    return FakeEngine(settings.fake_seconds, settings.data_dir / "fake-engine")


def open_client(settings: Settings, fake: FakeEngine) -> TestClient:
    c = TestClient(create_app(settings, fake))
    c.headers["Authorization"] = f"Bearer {TOKEN}"
    return c


@pytest.fixture
def client(settings: Settings, fake: FakeEngine) -> Iterator[TestClient]:
    with open_client(settings, fake) as c:
        yield c


def submit(client: TestClient, cid: str = "c1", **spec) -> dict:
    spec.setdefault("length", {"total_seconds": 10})
    r = client.post("/api/v1/jobs", json={"client_job_id": cid, **spec})
    assert r.status_code in (200, 202), r.text
    return r.json()


def wait_state(client: TestClient, job_id: str, *states: str, timeout: float = 15) -> dict:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = client.get(f"/api/v1/jobs/{job_id}").json()
        if job["state"] in states:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} stuck in {job['state']}, wanted {states}")
