"""Queue position + ETA (F16): a queued job waits for everything ahead of it."""

from pathlib import Path

import pytest

from soniyo_gateway import db, jobs
from soniyo_gateway.events import Hub
from soniyo_gateway.repo import Repo
from soniyo_gateway.schemas import BuilderSpec


@pytest.fixture
async def repo(tmp_path: Path) -> Repo:  # Hub needs a running loop
    return Repo(db.connect(tmp_path / "t.sqlite3"), Hub())


def add(repo: Repo, cid: str, seconds: int) -> str:
    spec = BuilderSpec(client_job_id=cid, length={"total_seconds": seconds})
    return jobs.create(repo, spec)[0].id


async def test_queued_eta_includes_running_remainder_and_jobs_ahead(repo: Repo) -> None:
    run, a, b = add(repo, "run", 100), add(repo, "a", 60), add(repo, "b", 30)
    done = add(repo, "done", 10)
    repo.update_job(done, state="cancelled", finished_at=db.now())
    repo.update_job(run, state="generating", started_at=db.now())  # ~0 s elapsed

    view = {j.id: j for j in jobs.list_jobs(repo, None, 50)}  # factor 1.0, no history
    assert view[run].position == 0 and 99 <= view[run].estimate_seconds_left <= 100
    assert view[a].position == 1 and 159 <= view[a].estimate_seconds_left <= 160
    assert view[b].position == 2 and 189 <= view[b].estimate_seconds_left <= 190
    assert view[done].position is None and view[done].estimate_seconds_left is None
    # a filtered/limited listing still counts the jobs ahead that it does not show
    only_b = jobs.list_jobs(repo, ["queued"], 1)[0]
    assert only_b.id == b and 189 <= only_b.estimate_seconds_left <= 190
    assert jobs.get(repo, b).estimate_seconds_left == pytest.approx(
        view[b].estimate_seconds_left, abs=1.5)  # fmt: skip


async def test_engine_prior_only_without_history(repo: Repo) -> None:
    job = add(repo, "q", 100)
    repo.engine_factor = 0.5
    assert jobs.get(repo, job).estimate_seconds_left == 50
    repo.generate_seconds_per_audio_second = lambda: 0.2  # own history wins
    assert jobs.get(repo, job).estimate_seconds_left == 20
