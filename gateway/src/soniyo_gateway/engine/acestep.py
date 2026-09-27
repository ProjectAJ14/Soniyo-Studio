"""ACE-Step 1.5 `acestep-api` adapter (docs/en/API.md upstream).

Every response is wrapped: {"data": ..., "code": 200, "error": null, "timestamp", "extra"}.
Auth: `Authorization: Bearer ACESTEP_API_KEY`.

EngineParams -> POST /release_task (JSON):
    prompt, lyrics, lm_negative_prompt, key_scale, time_signature, audio_duration,
    thinking, use_cot_caption, lm_temperature, batch_size, inference_steps, audio_format
                                     -> same names
    bpm (None)                       -> omitted, so the LM/engine fills it
    vocal_language ("")              -> omitted (engine default)
    seed < 0                         -> use_random_seed=true (seed omitted)
    seed >= 0                        -> use_random_seed=false, seed=<seed>
    response data.task_id            -> task id

POST /query_result {"task_id_list": [id]} -> data[i] {task_id, status 0|1|2, result}
    result is a JSON *string* holding a list; first item gives
    file "/v1/audio?path=<p>" -> audio_path <p>, seed_value "123,456" -> seed 123,
    dit_model / lm_model -> info. A task the engine no longer knows (e.g. after its
    restart) is reported as failed.

GET /v1/audio?path=<p>              -> FLAC bytes
GET /health data.status == "ok"     + GET /v1/models data.models[].name -> health()
POST /format_input {prompt, lyrics, temperature, param_obj: JSON string of
    {duration, bpm, key, time_signature, language}} -> data {caption, lyrics, bpm,
    key_scale, time_signature, duration, vocal_language} -> Formatted

GET /v1/stats is not used: time-left comes from the gateway's own history (jobs.py).
"""

import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

from ..errors import ApiError
from ..schemas import EngineParams
from . import EngineResult, Formatted

_STATUS = {0: "running", 1: "succeeded", 2: "failed"}


class AceStepEngine:
    def __init__(
        self, base_url: str, api_key: str, transport: httpx.AsyncBaseTransport | None = None
    ):
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._http = httpx.AsyncClient(
            base_url=base_url, headers=headers, timeout=30.0, transport=transport
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _call(self, method: str, path: str, *, wait: float = 30.0, **kw) -> object:
        try:
            r = await self._http.request(method, path, timeout=wait, **kw)
        except httpx.TransportError as e:
            raise ApiError("engine_unavailable", f"Engine unreachable: {type(e).__name__}") from e
        if r.status_code in (429,) or r.status_code >= 500:
            raise ApiError("engine_unavailable", f"Engine busy or failing (HTTP {r.status_code}).")
        try:
            body = r.json()
        except ValueError as e:
            raise ApiError("internal", f"Engine sent non-JSON (HTTP {r.status_code}).") from e
        if r.status_code >= 400:
            detail = body.get("detail") if isinstance(body, dict) else None
            raise ApiError("internal", f"Engine rejected {path} (HTTP {r.status_code}): {detail}")
        if not isinstance(body, dict) or body.get("code", 200) != 200 or body.get("error"):
            err = body.get("error") if isinstance(body, dict) else None
            raise ApiError("internal", f"Engine error on {path}: {err}")
        return body.get("data")

    async def submit(self, params: EngineParams) -> str:
        data = await self._call("POST", "/release_task", json=release_body(params))
        if not isinstance(data, dict) or not data.get("task_id"):
            raise ApiError("internal", "Engine accepted the task but returned no task_id.")
        return str(data["task_id"])

    async def query(self, task_id: str) -> EngineResult:
        data = await self._call("POST", "/query_result", json={"task_id_list": [task_id]})
        item = next(
            (d for d in data or [] if isinstance(d, dict) and d.get("task_id") == task_id), None
        )
        if item is None:
            return EngineResult("failed", error="Engine no longer knows this task.")
        return parse_query_item(item)

    async def fetch_audio(self, path: str, dest: Path) -> None:
        part = dest.with_suffix(dest.suffix + ".part")
        try:
            async with self._http.stream(
                "GET", "/v1/audio", params={"path": path}, timeout=300.0
            ) as r:
                if r.status_code != 200:
                    raise ApiError("internal", f"Engine audio fetch failed (HTTP {r.status_code}).")
                # ponytail: sync chunk writes on the loop; local SSD makes them sub-ms.
                with part.open("wb") as f:
                    async for chunk in r.aiter_bytes(1 << 16):
                        f.write(chunk)
        except httpx.TransportError as e:
            part.unlink(missing_ok=True)
            raise ApiError("engine_unavailable", f"Engine unreachable: {type(e).__name__}") from e
        except BaseException:
            part.unlink(missing_ok=True)
            raise
        part.replace(dest)

    async def health(self) -> tuple[bool, list[str], str | None]:
        try:
            data = await self._call("GET", "/health", wait=10.0)
            if not isinstance(data, dict) or data.get("status") != "ok":
                return False, [], f"Engine health says {data!r}"
            models = await self._call("GET", "/v1/models", wait=10.0)
        except ApiError as e:
            return False, [], e.message
        names = [m["name"] for m in (models or {}).get("models", []) if "name" in m]
        return True, names, None

    async def format_input(self, params: EngineParams) -> Formatted:
        meta = {"duration": params.audio_duration, "language": params.vocal_language or None}
        if params.bpm:
            meta["bpm"] = params.bpm
        if params.key_scale:
            meta["key"] = params.key_scale
        if params.time_signature:
            meta["time_signature"] = params.time_signature
        body = {
            "prompt": params.prompt,
            "lyrics": params.lyrics,
            "temperature": params.lm_temperature,
            "param_obj": json.dumps(meta),
        }
        data = await self._call("POST", "/format_input", json=body, wait=300.0)
        if not isinstance(data, dict):
            raise ApiError("internal", "Engine format_input returned no data.")
        bpm = data.get("bpm")
        return Formatted(
            caption=str(data.get("caption") or ""),
            lyrics=str(data.get("lyrics") or ""),
            bpm=int(bpm) if isinstance(bpm, int | float) and bpm else None,
            key_scale=str(data.get("key_scale") or ""),
            time_signature=str(data.get("time_signature") or ""),
        )


def release_body(p: EngineParams) -> dict:
    body: dict = {
        "prompt": p.prompt,
        "lyrics": p.lyrics,
        "lm_negative_prompt": p.lm_negative_prompt,
        "key_scale": p.key_scale,
        "time_signature": p.time_signature,
        "audio_duration": p.audio_duration,
        "thinking": p.thinking,
        "use_cot_caption": p.use_cot_caption,
        "lm_temperature": p.lm_temperature,
        "batch_size": p.batch_size,
        "inference_steps": p.inference_steps,
        "audio_format": p.audio_format,
        "use_random_seed": p.seed < 0,
    }
    if p.seed >= 0:
        body["seed"] = p.seed
    if p.bpm is not None:
        body["bpm"] = p.bpm
    if p.vocal_language:
        body["vocal_language"] = p.vocal_language
    return body


def parse_query_item(item: dict) -> EngineResult:
    status = _STATUS.get(item.get("status"), "failed")
    raw = item.get("result") or "[]"
    try:
        results = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        results = []
    first = results[0] if isinstance(results, list) and results else {}
    if status == "running":
        return EngineResult("running")
    if status == "failed":
        msg = item.get("error") or first.get("error") or "Engine reported the render failed."
        return EngineResult("failed", error=str(msg))
    file_url = first.get("file") or ""
    path = parse_qs(urlparse(file_url).query).get("path", [""])[0] or None
    if path is None:
        return EngineResult("failed", error="Engine finished but returned no audio file.")
    seed_str = str(first.get("seed_value") or "").split(",")[0].strip()
    info = {k: str(first[f"{k}_model"]) for k in ("dit", "lm") if first.get(f"{k}_model")}
    return EngineResult(
        "succeeded",
        audio_path=path,
        seed=int(seed_str) if seed_str.lstrip("-").isdigit() else None,
        info=info,
    )
