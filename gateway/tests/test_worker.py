import dataclasses
import sqlite3
import time
from pathlib import Path

from conftest import open_client, submit, wait_state

from soniyo_gateway.config import Settings
from soniyo_gateway.engine.fake import FakeEngine


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
        assert c.get("/api/v1/health").json()["engine"]["status"] == "ok"


def test_lm_text_pass_then_lm_off_render(settings: Settings, fake: FakeEngine) -> None:
    settings = dataclasses.replace(settings, lm_cap_seconds=5)
    with open_client(settings, fake) as c:
        job = wait_state(c, submit(c, "long", style="drone")["id"], "succeeded")
        sent = fake.submitted[-1]
        assert sent.thinking is False and sent.use_cot_caption is False
        assert sent.prompt.endswith(", planned") and sent.bpm == 72
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
