"""End-to-end smoke: a real uvicorn process with the fake engine, driven over HTTP the way the
web app drives it (CORS, bearer + ?token=, SSE, Range). Needs ffmpeg; skipped without it."""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest

TOKEN = "e2e-" + "k" * 40
ORIGIN = "http://localhost:5173"

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg not installed")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[str, Path]]:
    tmp = tmp_path_factory.mktemp("e2e")
    web = tmp / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Soniyo Studio</title>")
    port = _free_port()
    env = {
        **os.environ,
        "SONIYO_OWNER_TOKEN": TOKEN,
        "SONIYO_ENGINE": "fake",
        "SONIYO_FAKE_SECONDS": "0.3",
        "SONIYO_ENGINE_POLL_SECONDS": "0.1",
        "SONIYO_DATA_DIR": str(tmp / "data"),
        "SONIYO_LOG_DIR": str(tmp / "logs"),
        "SONIYO_WEB_DIST": str(web),
        "SONIYO_PORT": str(port),
        "SONIYO_CORS_ORIGINS": ORIGIN,
    }
    proc = subprocess.Popen(
        [sys.executable, "-c", "from soniyo_gateway.main import run; run()"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )  # fmt: skip
    base = f"http://127.0.0.1:{port}"
    try:
        end = time.monotonic() + 20
        while True:
            try:
                httpx.get(base + "/api/v1/health", timeout=0.5)
                break
            except httpx.TransportError:
                if proc.poll() is not None or time.monotonic() > end:
                    raise RuntimeError("gateway did not start") from None
                time.sleep(0.1)
        yield base, tmp / "logs" / "gateway.log"
    finally:
        proc.terminate()
        proc.wait(10)


def test_full_http_flow(server: tuple[str, Path]) -> None:
    base, log_file = server
    api = base + "/api/v1"
    auth = {"Authorization": f"Bearer {TOKEN}"}
    c = httpx.Client(timeout=10)

    # Public health is reduced; authed health is full.
    assert c.get(api + "/health").json().keys() == {"status", "version"}
    assert c.get(api + "/health", headers=auth).json()["engine"]["status"] == "ok"

    # CORS preflight for the dev origin, and a wrong token is a JSON 401.
    pre = c.options(api + "/catalog", headers={
        "Origin": ORIGIN, "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization"})  # fmt: skip
    assert pre.headers["access-control-allow-origin"] == ORIGIN
    bad = c.get(api + "/catalog", headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401 and bad.json()["error"]["code"] == "unauthorized"
    assert c.get(api + "/nope", headers=auth).json()["error"]["code"] == "not_found"

    # Concurrent sync routes share one sqlite connection (regression: sporadic 500s).
    paths = ["/health", "/songs", "/jobs", "/presets"] * 10
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda p: c.get(api + p, headers=auth).status_code, paths))
    assert set(codes) == {200}

    # Shiva preset compiles; submitting is idempotent on client_job_id.
    presets = c.get(api + "/presets", headers=auth).json()["items"]
    spec = next(p for p in presets if p["id"] == "builtin-shiva-mantra")["spec"]
    spec["length"]["total_seconds"] = 10
    compiled = c.post(api + "/compile", json=spec, headers=auth).json()
    assert "Shiva" in compiled["caption"] and compiled["params"]["audio_duration"] == 10
    body = {**spec, "client_job_id": "e2e-1"}
    first = c.post(api + "/jobs", json=body, headers=auth)
    again = c.post(api + "/jobs", json=body, headers=auth)
    assert (first.status_code, again.status_code) == (202, 200)
    job_id = first.json()["id"]
    assert again.json()["id"] == job_id

    # SSE with ?token= (EventSource cannot send headers) until a terminal state.
    states: list[str] = []
    with c.stream("GET", f"{api}/jobs/{job_id}/events", params={"token": TOKEN},
                  timeout=30) as r:  # fmt: skip
        assert r.headers["content-type"].startswith("text/event-stream")
        for line in r.iter_lines():
            if line.startswith("data: "):
                job = json.loads(line[6:])
                states.append(job["state"])
    assert states[-1] == "succeeded", states
    song_id = job["song_id"]

    # Library + Range playback with ?token= (<audio> cannot send headers).
    songs = c.get(api + "/songs", headers=auth).json()
    assert [s["id"] for s in songs["items"]] == [song_id]
    audio = f"{api}/songs/{song_id}/audio"
    part = c.get(audio, params={"token": TOKEN}, headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert part.headers["content-type"] == "audio/mpeg"
    assert c.get(audio, params={"token": "nope"}).status_code == 401

    # Rename carries into a regeneration; delete unlinks the job and removes audio.
    renamed = c.patch(f"{api}/songs/{song_id}", json={"title": "Evening", "favourite": True},
                      headers=auth).json()  # fmt: skip
    assert (renamed["title"], renamed["favourite"]) == ("Evening", True)
    regen = c.post(f"{api}/songs/{song_id}/regenerate", json={"seed": "new"}, headers=auth)
    assert regen.status_code == 202 and regen.json()["title"] == "Evening"
    assert c.delete(f"{api}/songs/{song_id}", headers=auth).status_code == 204
    assert c.get(f"{api}/jobs/{job_id}", headers=auth).json()["song_id"] is None
    assert c.get(audio, params={"token": TOKEN}).status_code == 404

    # Same-origin SPA fallback, and the token never reaches the log.
    assert "Soniyo Studio" in c.get(base + "/").text
    assert TOKEN not in log_file.read_text()
