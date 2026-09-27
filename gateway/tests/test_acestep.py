"""Contract tests: AceStepEngine against recorded engine responses (fixtures/engine)."""

import json
from pathlib import Path

import httpx
import pytest

from soniyo_gateway.engine.acestep import AceStepEngine
from soniyo_gateway.errors import ApiError
from soniyo_gateway.schemas import EngineParams

FIX = Path(__file__).parent / "fixtures" / "engine"
TASK = "550e8400-e29b-41d4-a716-446655440000"


def fixture(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


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

    await e.submit(params(seed=42, bpm=60))
    body = json.loads(seen[1].content)
    assert body["use_random_seed"] is False and body["seed"] == 42 and body["bpm"] == 60


@pytest.mark.parametrize(
    ("name", "status"),
    [("query_result_running", "running"), ("query_result_succeeded", "succeeded"),
     ("query_result_failed", "failed")],
)  # fmt: skip
async def test_query_status_mapping(name: str, status: str) -> None:
    seen: list[httpx.Request] = []
    r = await engine({"/query_result": (200, fixture(name))}, seen).query(TASK)
    assert json.loads(seen[0].content) == {"task_id_list": [TASK]}
    assert r.status == status
    if status == "succeeded":
        assert r.audio_path == "/tmp/api_audio/abc123.flac" and r.seed == 12345
        assert r.info == {"dit": "acestep-v15-turbo", "lm": "acestep-5Hz-lm-0.6B"}
    if status == "failed":
        assert r.error == "CUDA out of memory"


async def test_unknown_task_is_failed() -> None:
    r = await engine({"/query_result": (200, {"data": [], "code": 200})}, []).query(TASK)
    assert r.status == "failed"


async def test_fetch_audio_and_health(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []
    e = engine({"/v1/audio": (200, b"fLaC-bytes"), "/health": (200, fixture("health")),
                "/v1/models": (200, fixture("models"))}, seen)  # fmt: skip
    dest = tmp_path / "x.flac"
    await e.fetch_audio("/tmp/api_audio/abc123.flac", dest)
    assert dest.read_bytes() == b"fLaC-bytes"
    assert seen[0].url.params["path"] == "/tmp/api_audio/abc123.flac"
    assert await e.health() == (True, ["acestep-v15-turbo", "acestep-v15-turbo-shift3"], None)


async def test_format_input() -> None:
    seen: list[httpx.Request] = []
    f = await engine({"/format_input": (200, fixture("format_input"))}, seen).format_input(
        params(bpm=60)
    )
    body = json.loads(seen[0].content)
    assert json.loads(body["param_obj"]) == {"duration": 600, "language": "sa", "bpm": 60,
                                             "time_signature": "4"}  # fmt: skip
    assert (f.caption, f.lyrics, f.bpm, f.key_scale) == (
        "Enhanced music description", "Formatted lyrics...", 120, "C Major")  # fmt: skip


async def test_errors_map_to_api_errors() -> None:
    e = engine({"/release_task": (401, fixture("error_401")), "/health": (503, {})}, [])
    with pytest.raises(ApiError) as err:
        await e.submit(params())
    assert err.value.code == "internal" and "Invalid API key" in err.value.message
    ok, _, msg = await e.health()
    assert ok is False and "503" in msg

    def down(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    dead = AceStepEngine("http://engine", "", transport=httpx.MockTransport(down))
    with pytest.raises(ApiError) as err:
        await dead.submit(params())
    assert err.value.code == "engine_unavailable" and err.value.retryable
