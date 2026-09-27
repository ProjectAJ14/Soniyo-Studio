import base64
import dataclasses
import hashlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from conftest import ORIGIN, TOKEN, open_client, submit, wait_state
from fastapi.testclient import TestClient

from soniyo_gateway.audio import safe_filename
from soniyo_gateway.config import Settings
from soniyo_gateway.engine.fake import FakeEngine
from soniyo_gateway.main import setup_logging


def test_auth_required_and_error_shape(client: TestClient) -> None:
    for headers in ({"Authorization": ""}, {"Authorization": "Bearer wrong"}):
        r = client.get("/api/v1/jobs", headers=headers)
        assert r.status_code == 401
        assert r.json() == {"error": {"code": "unauthorized",
                                      "message": "Missing or wrong owner token.",
                                      "retryable": False}}  # fmt: skip
    # ?token= is accepted only on audio + events
    r = client.get(f"/api/v1/jobs?token={TOKEN}", headers={"Authorization": ""})
    assert r.status_code == 401


def test_health_bare_vs_authed(client: TestClient) -> None:
    bare = client.get("/api/v1/health", headers={"Authorization": "Bearer nope"}).json()
    assert set(bare) == {"status", "version"}
    full = client.get("/api/v1/health").json()
    assert full["engine"]["status"] in ("ok", "unknown")
    assert full["queue_depth"] == 0 and full["disk"]["free_bytes"] > 0
    assert full["running_job_id"] is None and "last_error" in full["engine"]


def test_cors_allow_and_deny(client: TestClient) -> None:
    pre = {"Access-Control-Request-Method": "POST",
           "Access-Control-Request-Headers": "authorization"}  # fmt: skip
    ok = client.options("/api/v1/jobs", headers={"Origin": ORIGIN, **pre})
    assert ok.headers["access-control-allow-origin"] == ORIGIN
    bad = client.options("/api/v1/jobs", headers={"Origin": "https://evil.example", **pre})
    assert "access-control-allow-origin" not in bad.headers


def test_unhandled_error_is_json_with_cors(client: TestClient, monkeypatch) -> None:
    def boom() -> int:
        raise RuntimeError("boom")

    monkeypatch.setattr(client.app.state.rt.repo, "library_bytes", boom)
    r = client.get("/api/v1/health", headers={"Origin": ORIGIN})
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "internal"
    assert r.headers["access-control-allow-origin"] == ORIGIN  # browser can read it


def test_validation_error_shape(client: TestClient) -> None:
    r = client.post("/api/v1/jobs", json={"client_job_id": "x", "length": {"mode": "loop"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_failed"
    r = client.post("/api/v1/jobs", json={})
    assert r.status_code == 422 and "client_job_id" in r.json()["error"]["message"]


def test_catalog_and_compile(client: TestClient) -> None:
    assert client.get("/api/v1/catalog").json()["lm_cap_seconds"] == 480
    r = client.post("/api/v1/compile", json={})
    assert r.status_code == 200 and r.json()["params"]["audio_format"] == "flac"


def test_idempotent_create(client: TestClient) -> None:
    client.app.state.rt.engine.seconds = 30  # keep it running
    r1 = client.post("/api/v1/jobs", json={"client_job_id": "same", "title": "A"})
    r2 = client.post("/api/v1/jobs", json={"client_job_id": "same", "title": "B"})
    assert (r1.status_code, r2.status_code) == (202, 200)
    assert r1.json()["id"] == r2.json()["id"] and r2.json()["title"] == "A"


def test_idempotent_create_concurrent(client: TestClient, monkeypatch) -> None:
    client.app.state.rt.engine.seconds = 30
    repo = client.app.state.rt.repo
    first = client.post("/api/v1/jobs", json={"client_job_id": "race"}).json()
    real, calls = repo.get_job_by_client_id, []

    def lagging(cid: str):  # the pre-insert check misses the concurrent winner's row
        calls.append(cid)
        return None if len(calls) == 1 else real(cid)

    monkeypatch.setattr(repo, "get_job_by_client_id", lagging)
    r = client.post("/api/v1/jobs", json={"client_job_id": "race"})
    assert r.status_code == 200 and r.json()["id"] == first["id"]

    monkeypatch.undo()
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(
            lambda _: client.post("/api/v1/jobs", json={"client_job_id": "par"}).status_code,
            range(8),
        ))  # fmt: skip
    assert sorted(codes) == [200] * 7 + [202]


def test_lifecycle_song_and_sse(client: TestClient) -> None:
    job = submit(client, title="Om / Namah: Shivaya", style="calm drone")
    assert job["state"] == "queued" and job["position"] in (0, 1)
    with client.stream("GET", f"/api/v1/jobs/{job['id']}/events?token={TOKEN}",
                       headers={"Authorization": ""}) as r:  # fmt: skip
        assert r.headers["content-type"].startswith("text/event-stream")
        body = r.read().decode()
    frames = [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]
    assert "event: job" in body and frames[-1]["state"] == "succeeded"
    done = wait_state(client, job["id"], "succeeded")
    assert done["position"] is None and done["estimate_seconds_left"] is None
    assert {"compile", "generate", "encode"} <= set(done["timings"])
    song = client.get(f"/api/v1/songs/{done['song_id']}").json()
    assert song["job_id"] == job["id"] and 9.5 < song["duration_seconds"] < 10.5
    assert song["seed"] is not None and song["size_bytes"] > 0

    listing = client.get("/api/v1/songs?q=drone").json()
    assert [s["id"] for s in listing["items"]] == [song["id"]]
    assert listing["storage"]["used_bytes"] == song["size_bytes"]
    assert client.get("/api/v1/songs?q=nothing%25").json()["items"] == []
    assert client.get("/api/v1/jobs?state=succeeded").json()["items"][0]["id"] == job["id"]


def test_audio_range_and_download(client: TestClient) -> None:
    done = wait_state(client, submit(client, title='Om "x"')["id"], "succeeded")
    url = f"/api/v1/songs/{done['song_id']}/audio"
    full = client.get(url)
    assert full.status_code == 200 and full.headers["accept-ranges"] == "bytes"
    assert full.headers["content-type"] == "audio/mpeg"
    size = len(full.content)
    part = client.get(url, headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    assert part.headers["content-range"] == f"bytes 0-99/{size}"
    bad = client.get(url, headers={"Range": f"bytes={size + 10}-"})
    assert bad.status_code == 416 and bad.json()["error"]["code"] == "range_not_satisfiable"
    flac = client.get(f"{url}?format=flac&download=1&token={TOKEN}", headers={"Authorization": ""})
    assert flac.headers["content-type"] == "audio/flac"
    assert flac.headers["content-disposition"] == "attachment; filename*=utf-8''Om%20x.flac"


def test_song_patch_delete_regenerate(client: TestClient, settings) -> None:
    done = wait_state(client, submit(client)["id"], "succeeded")
    sid = done["song_id"]
    r = client.patch(f"/api/v1/songs/{sid}", json={"title": "Renamed", "favourite": True})
    assert r.json()["title"] == "Renamed" and r.json()["favourite"] is True
    assert len(client.get("/api/v1/songs?favourite=true").json()["items"]) == 1
    seed = r.json()["seed"]
    regen = client.post(f"/api/v1/songs/{sid}/regenerate", json={"seed": "same"})
    assert regen.status_code == 202 and regen.json()["spec"]["engine"]["seed"] == seed
    wait_state(client, regen.json()["id"], "succeeded")
    assert client.delete(f"/api/v1/songs/{sid}").status_code == 204
    assert client.get(f"/api/v1/songs/{sid}").status_code == 404
    assert not (settings.audio_dir / f"{sid}.mp3").exists()
    assert not (settings.audio_dir / f"{sid}.flac").exists()


def test_cancel_queued_vs_running_and_retry(client: TestClient) -> None:
    fake = client.app.state.rt.engine
    fake.seconds = 1.0
    running = submit(client, "run")
    queued = submit(client, "wait")
    wait_state(client, running["id"], "generating")
    assert client.get(f"/api/v1/jobs/{queued['id']}").json()["position"] == 1
    r = client.post(f"/api/v1/jobs/{running['id']}/cancel")
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    r = client.post(f"/api/v1/jobs/{queued['id']}/cancel")
    assert r.status_code == 200 and r.json()["state"] == "cancelled"
    assert r.json()["position"] is None

    fake.fail = True
    wait_state(client, running["id"], "succeeded")  # was submitted before fail flipped
    failed = wait_state(client, submit(client, "boom")["id"], "failed")
    assert failed["error"]["retryable"] is True
    assert client.post(f"/api/v1/jobs/{running['id']}/retry").status_code == 409
    fake.fail, fake.seconds = False, 0.2
    retry = client.post(f"/api/v1/jobs/{failed['id']}/retry")
    assert retry.status_code == 202 and retry.json()["client_job_id"] != "boom"
    assert wait_state(client, retry.json()["id"], "succeeded")["spec"]["length"] == {
        "mode": "single", "total_seconds": 10}  # fmt: skip


def test_presets_crud_and_builtin_conflict(client: TestClient) -> None:
    items = client.get("/api/v1/presets").json()["items"]
    builtin = [p for p in items if p["builtin"]]
    assert builtin and items[: len(builtin)] == builtin
    bid = builtin[0]["id"]
    assert client.put(f"/api/v1/presets/{bid}", json={"name": "x", "spec": {}}).status_code == 409
    assert client.delete(f"/api/v1/presets/{bid}").status_code == 409

    r = client.post("/api/v1/presets", json={"name": "Mine", "spec": {"style": "soft"}})
    assert r.status_code == 201
    pid = r.json()["id"]
    r = client.put(f"/api/v1/presets/{pid}", json={"name": "Mine 2", "spec": {"style": "warm"}})
    assert r.json()["name"] == "Mine 2" and r.json()["spec"]["style"] == "warm"
    assert client.delete(f"/api/v1/presets/{pid}").status_code == 204
    assert client.get(f"/api/v1/presets/{pid}").status_code == 404


def test_safe_filename() -> None:
    assert safe_filename("../a/b\\c:d", "mp3") == "a b c d.mp3"
    assert safe_filename("  ", "flac") == "song.flac"
    assert safe_filename("ॐ नमः शिवाय", "mp3") == "ॐ नमः शिवाय.mp3"


def test_json_logging(tmp_path: Path) -> None:
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    try:
        setup_logging(tmp_path)
        logging.getLogger("soniyo_gateway").info("hello %s", "world")
        for h in root.handlers:
            h.flush()
        line = (tmp_path / "gateway.log").read_text().strip().splitlines()[-1]
        assert json.loads(line)["msg"] == "hello world"
    finally:
        for h in root.handlers:
            h.close()
        root.handlers[:] = handlers
        root.setLevel(level)


def test_spec_size_limits(client: TestClient) -> None:
    for bad in (
        {"lyrics": {"text": "x" * 100, "repeat": 1000}},  # 100k chars once repeated
        {"lyrics": {"text": "x" * 20_001}},
        {"moods": ["x" * 81]},
        {"music": {"time_signature": "banana"}},
        {"client_job_id": "x" * 101},
    ):
        r = client.post("/api/v1/compile", json=bad)
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_failed", bad
    ok = client.post("/api/v1/compile", json={"lyrics": {"text": "om " * 16, "repeat": 1000}})
    assert ok.status_code == 200


def test_preset_id_reaches_song_not_preset(client: TestClient) -> None:
    job = wait_state(client, submit(client, "from-preset", preset_id="p-shiva")["id"], "succeeded")
    assert client.get(f"/api/v1/songs/{job['song_id']}").json()["preset_id"] == "p-shiva"
    p = client.post("/api/v1/presets", json={"name": "n", "spec": {"preset_id": "p-shiva"}})
    assert p.json()["spec"]["preset_id"] is None


def test_regenerate_same_without_seed_conflicts(client: TestClient) -> None:
    job = wait_state(client, submit(client, "noseed")["id"], "succeeded")
    repo = client.app.state.rt.repo
    repo.update_song(job["song_id"], seed=None)
    r = client.post(f"/api/v1/songs/{job['song_id']}/regenerate", json={"seed": "same"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    r = client.post(f"/api/v1/songs/{job['song_id']}/regenerate", json={"seed": "new"})
    assert r.status_code == 202


def test_errors_keep_documented_codes(client: TestClient) -> None:
    r = client.put("/api/v1/jobs")
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"


def test_spa_served_with_security_headers(settings: Settings, fake: FakeEngine,
                                          tmp_path: Path) -> None:  # fmt: skip
    dist = tmp_path / "dist"
    dist.mkdir()
    html = '<script>boot()</script><script type="module" src="/a.js"></script>'
    (dist / "index.html").write_text(html)
    with open_client(dataclasses.replace(settings, web_dist=dist), fake) as c:
        r = c.get("/")
        csp = r.headers["content-security-policy"]
        digest = base64.b64encode(hashlib.sha256(b"boot()").digest()).decode()
        assert f"'sha256-{digest}'" in csp and "frame-ancestors 'none'" in csp
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["referrer-policy"] == "no-referrer"
        api = c.get("/api/v1/health")
        assert "content-security-policy" not in api.headers
        assert api.headers["referrer-policy"] == "no-referrer"


def test_host_must_be_loopback(monkeypatch) -> None:
    monkeypatch.setenv("SONIYO_OWNER_TOKEN", "t" * 40)
    monkeypatch.setenv("SONIYO_HOST", "0.0.0.0")
    with pytest.raises(SystemExit):
        Settings.from_env()
