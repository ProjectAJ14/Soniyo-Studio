"""Contract tests: AceStepEngine against real engine captures (fixtures/engine, README)."""

import json
from pathlib import Path

import httpx
import pytest

from soniyo_gateway.engine.acestep import AceStepEngine
from soniyo_gateway.errors import ApiError
from soniyo_gateway.schemas import EngineParams

FIX = Path(__file__).parent / "fixtures" / "engine"


def fixture(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


TASK = fixture("release_task")["data"]["task_id"]
AUDIO = ("/Users/owner/AceStudio/engine/ACE-Step-1.5/.cache/acestep/tmp/api_audio/"
         "464d5cf2-8eb5-812b-548b-4f1e33eeb713.flac")  # fmt: skip


def params(**kw) -> EngineParams:
    base = dict(prompt="calm drone", lyrics="", lm_negative_prompt="EDM", bpm=None, key_scale="",
                time_signature="4", audio_duration=600, vocal_language="sa", thinking=False,
                use_cot_caption=False, seed=-1, lm_temperature=0.85)  # fmt: skip
    return EngineParams(**{**base, **kw})


def engine(routes: dict, seen: list[httpx.Request]) -> AceStepEngine:
    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        status, body = routes[req.url.path]
        if isinstance(body, bytes):
            return httpx.Response(status, content=body)
        return httpx.Response(status, json=body)

    return AceStepEngine("http://engine", "secret-key", transport=httpx.MockTransport(handler))


async def test_submit_maps_params_and_auth() -> None:
    seen: list[httpx.Request] = []
    e = engine({"/release_task": (200, fixture("release_task"))}, seen)
    assert await e.submit(params()) == TASK
    body = json.loads(seen[0].content)
    assert seen[0].headers["authorization"] == "Bearer secret-key"
    assert body["batch_size"] == 1 and body["inference_steps"] == 8
    assert body["audio_format"] == "flac" and body["use_random_seed"] is True
    assert "seed" not in body and "bpm" not in body and body["vocal_language"] == "sa"
    assert body["lm_negative_prompt"] == "EDM" and body["audio_duration"] == 600
    assert body["time_signature"] == "4"
    await e.submit(params(time_signature="", vocal_language=""))  # Auto: engine decides
    auto = json.loads(seen[-1].content)
    assert "time_signature" not in auto and "vocal_language" not in auto

    await e.submit(params(seed=42, bpm=60))
    body = json.loads(seen[-1].content)
    assert body["use_random_seed"] is False and body["seed"] == 42 and body["bpm"] == 60


@pytest.mark.parametrize(
    ("name", "status"),
    [("query_result_running", "running"), ("query_result_succeeded", "succeeded"),
     ("query_result_failed", "failed")],
)  # fmt: skip
async def test_query_status_mapping(name: str, status: str) -> None:
    seen: list[httpx.Request] = []
    body = fixture(name)
    task = body["data"][0]["task_id"]
    r = await engine({"/query_result": (200, body)}, seen).query(task)
    assert json.loads(seen[0].content) == {"task_id_list": [task]}
    assert r.status == status
    if status == "succeeded":
        assert r.audio_path == AUDIO and r.seed == 1326605104
        assert r.info == {"dit": "acestep-v15-turbo", "lm": "acestep-5Hz-lm-0.6B"}
    if status == "failed":  # the real engine sends no reason; it is only in its log
        assert r.error and "engine log" in r.error


async def test_unknown_task_is_failed() -> None:
    # the engine answers status 0 (running) with result "[]" for ids it does not know
    unknown = fixture("query_result_unknown")
    r = await engine({"/query_result": (200, unknown)}, []).query(unknown["data"][0]["task_id"])
    assert r.status == "failed"
    r = await engine({"/query_result": (200, {"data": [], "code": 200})}, []).query(TASK)
    assert r.status == "failed"


async def test_fetch_audio_and_health(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    e = engine({"/v1/audio": (200, b"fLaC-bytes"), "/health": (200, fixture("health")),
                "/v1/model_inventory": (200, fixture("model_inventory"))}, seen)  # fmt: skip
    dest = tmp_path / "x.flac"
    await e.fetch_audio(AUDIO, dest)
    assert dest.read_bytes() == b"fLaC-bytes"
    assert seen[0].url.params["path"] == AUDIO
    assert await e.health() == (True, ["acestep-v15-turbo"], None)


async def test_format_input() -> None:
    seen: list[httpx.Request] = []
    f = await engine({"/format_input": (200, fixture("format_input"))}, seen).format_input(
        params(bpm=60)
    )
    body = json.loads(seen[0].content)
    assert json.loads(body["param_obj"]) == {"duration": 600, "language": "sa", "bpm": 60,
                                             "time_signature": "4"}  # fmt: skip
    assert f.caption.startswith("A serene and meditative piece") and f.lyrics.startswith("[Intro")
    assert (f.bpm, f.key_scale, f.time_signature, f.vocal_language) == (60, "D major", "4", "sa")


async def test_errors_map_to_api_errors() -> None:
    e = engine({"/release_task": (401, fixture("error_401")), "/health": (503, {})}, [])
    with pytest.raises(ApiError) as err:
        await e.submit(params())
    assert err.value.code == "internal" and err.value.retryable is False
    assert "Invalid API key" not in err.value.message  # engine detail stays in the log
    ok, _, msg = await e.health()
    assert ok is False and "503" in msg

    def down(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    dead = AceStepEngine("http://engine", "", transport=httpx.MockTransport(down))
    with pytest.raises(ApiError) as err:
        await dead.submit(params())
    assert err.value.code == "engine_unavailable" and err.value.retryable


async def test_avg_job_seconds_from_stats() -> None:
    seen: list[httpx.Request] = []
    stats = fixture("stats")  # real capture: fresh engine, avg is its 5.0 default, not measured
    assert await engine({"/v1/stats": (200, stats)}, seen).avg_job_seconds() is None
    assert seen[0].method == "GET"
    stats["data"]["jobs"]["succeeded"] = 3
    stats["data"]["avg_job_seconds"] = 37.5
    assert await engine({"/v1/stats": (200, stats)}, []).avg_job_seconds() == 37.5
    assert await engine({"/v1/stats": (503, {})}, []).avg_job_seconds() is None
    empty = {"data": {"avg_job_seconds": 0}, "code": 200}
    assert await engine({"/v1/stats": (200, empty)}, []).avg_job_seconds() is None
