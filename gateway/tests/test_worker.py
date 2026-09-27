import dataclasses
import sqlite3
import time
from pathlib import Path

from conftest import open_client, submit, wait_state

from soniyo_gateway import jobs, worker
from soniyo_gateway.config import Settings
from soniyo_gateway.engine.fake import FakeEngine
from soniyo_gateway.errors import ApiError


def _insert(db: Path, job_id: str, state: str, task_id: str | None = None) -> None:
    conn = sqlite3.connect(db)
    conn.execute(
        "INSERT INTO jobs(id, client_job_id, title, state, spec, engine_task_id, created_at)"
        " VALUES (?, ?, 't', ?, '{\"length\": {\"total_seconds\": 10}}', ?,"
        " '2026-01-01T00:00:00Z')",
        (job_id, job_id, state, task_id),
    )
    conn.commit()
    conn.close()


def test_recovery_on_restart(settings: Settings, fake: FakeEngine) -> None:
    fake.seconds = 30
    with open_client(settings, fake) as c:
        a = submit(c, "a")
        wait_state(c, a["id"], "generating")
        b = submit(c, "b")
    # gateway "crashed" with a mid-render and b queued; add jobs stuck in other stages
    _insert(settings.db_path, "enc", "encoding")
    _insert(settings.db_path, "gen-no-task", "generating")
    fake.seconds = 0.2  # a's engine task is now finished
    with open_client(settings, fake) as c:
        lost = c.get("/api/v1/jobs/gen-no-task").json()
        assert lost["state"] == "failed" and lost["error"]["retryable"] is True
        assert wait_state(c, a["id"], "succeeded")["song_id"]
        for job_id in (b["id"], "enc"):
            wait_state(c, job_id, "succeeded")
    assert len(fake.submitted) == 3  # a once, then b and enc


def test_watchdog_fails_running_job_and_holds_queue(
    settings: Settings, fake: FakeEngine, tmp_path: Path
) -> None:
    marker = tmp_path / "restarted"
    settings = dataclasses.replace(settings, engine_restart_cmd=f"touch {marker}")
    fake.seconds = 30
    with open_client(settings, fake) as c:
        running = submit(c, "r")
        wait_state(c, running["id"], "generating")
        fake.healthy = False
        failed = wait_state(c, running["id"], "failed")
        assert failed["error"]["code"] == "engine_unavailable"
        assert failed["error"]["retryable"] is True
        health = c.get("/api/v1/health").json()["engine"]
        assert health["status"] == "down" and health["last_error"]
        for _ in range(100):  # the restart command runs right after the abort
            if marker.exists():
                break
            time.sleep(0.02)
        assert marker.exists()

        queued = submit(c, "q")
        time.sleep(0.3)
        assert c.get(f"/api/v1/jobs/{queued['id']}").json()["state"] == "queued"
        fake.seconds, fake.healthy = 0.2, True
        wait_state(c, queued["id"], "succeeded")
        health = c.get("/api/v1/health").json()["engine"]
        assert health["status"] == "ok" and health["last_error"] is None


def test_lm_text_pass_then_lm_off_render(settings: Settings, fake: FakeEngine) -> None:
    settings = dataclasses.replace(settings, lm_cap_seconds=5)
    with open_client(settings, fake) as c:
        job = wait_state(c, submit(c, "long", style="drone")["id"], "succeeded")
        sent = fake.submitted[-1]
        assert sent.thinking is False and sent.use_cot_caption is False
        assert sent.prompt.endswith(", planned") and sent.bpm == 72
        assert sent.vocal_language == "en" and sent.time_signature == "4"  # filled by the LM
        assert job["compiled"]["params"]["bpm"] == 72

        fake.format_fails = True
        job = wait_state(c, submit(c, "long2")["id"], "succeeded")
        assert any("LM text pass failed" in n for n in job["compiled"]["notes"])
        assert fake.submitted[-1].thinking is False


def test_engine_failure_marks_job_failed(settings: Settings, fake: FakeEngine) -> None:
    fake.fail = True
    with open_client(settings, fake) as c:
        job = wait_state(c, submit(c)["id"], "failed")
        assert "Fake engine forced failure" in job["error"]["message"]
        assert job["finished_at"] and job["song_id"] is None
    assert not list(settings.audio_dir.glob("*"))


def test_queue_waits_for_engine_at_boot(settings: Settings, fake: FakeEngine) -> None:
    fake.healthy = False  # launchd started both; the engine is still loading models
    with open_client(settings, fake) as c:
        job = submit(c, "boot")
        time.sleep(0.4)  # well past several watchdog checks
        assert c.get(f"/api/v1/jobs/{job['id']}").json()["state"] == "queued"
        fake.healthy = True
        wait_state(c, job["id"], "succeeded")


def test_engine_unavailable_before_submit_requeues(
    settings: Settings, fake: FakeEngine, monkeypatch
) -> None:
    real, calls = fake.submit, []

    async def flaky(params):  # noqa: ANN001, ANN202
        calls.append(1)
        if len(calls) == 1:
            raise ApiError("engine_unavailable", "busy")
        return await real(params)

    monkeypatch.setattr(fake, "submit", flaky)
    with open_client(settings, fake) as c:
        job = wait_state(c, submit(c, "flaky")["id"], "succeeded", "failed")
        assert job["state"] == "succeeded" and len(calls) == 2


def test_poll_deadline_fails_hung_render(settings: Settings, fake: FakeEngine, monkeypatch) -> None:
    monkeypatch.setattr(worker, "MIN_RENDER_SECONDS", 0.3)
    monkeypatch.setattr(jobs, "DEFAULT_FACTOR", 0.001)
    fake.seconds = 60  # engine keeps answering "running"
    with open_client(settings, fake) as c:
        job = wait_state(c, submit(c, "hung")["id"], "failed")
        assert job["error"]["code"] == "engine_unavailable" and job["error"]["retryable"]
        fake.seconds = 0.2
        wait_state(c, submit(c, "next")["id"], "succeeded")  # the queue moved on


def test_worker_survives_repo_error(settings: Settings, fake: FakeEngine, monkeypatch) -> None:
    real, calls = worker._fail, []

    def broken_once(*a, **kw):  # noqa: ANN002, ANN003, ANN202
        calls.append(1)
        if len(calls) == 1:
            raise sqlite3.OperationalError("disk I/O error")
        return real(*a, **kw)

    monkeypatch.setattr(worker, "_fail", broken_once)
    fake.fail = True
    with open_client(settings, fake) as c:
        submit(c, "boom")
        for _ in range(100):
            if calls:
                break
            time.sleep(0.02)
        fake.fail = False
        wait_state(c, submit(c, "after")["id"], "succeeded", timeout=5)


def test_recovery_refetches_encoding_and_removes_orphans(
    settings: Settings, fake: FakeEngine
) -> None:
    fake.seconds = 30
    with open_client(settings, fake) as c:
        a = submit(c, "enc-task")
        wait_state(c, a["id"], "generating")
    conn = sqlite3.connect(settings.db_path)  # crashed after fetch, during encode
    conn.execute("UPDATE jobs SET state = 'encoding' WHERE id = ?", (a["id"],))
    conn.commit()
    conn.close()
    orphan = settings.audio_dir / "deadbeef.flac"
    orphan.write_bytes(b"x")
    fake.seconds = 0.2
    with open_client(settings, fake) as c:
        assert not orphan.exists()
        assert wait_state(c, a["id"], "succeeded")["song_id"]
    assert len(fake.submitted) == 1  # fetched, not re-rendered
