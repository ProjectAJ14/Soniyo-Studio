"""FakeEngine: renders a real FLAC tone with ffmpeg after `seconds`, so the whole pipeline
(fetch, encode, Range playback) runs on any machine. Tests flip `fail` / `healthy`."""

import asyncio
import random
import shutil
import time
import uuid
from pathlib import Path

from ..errors import ApiError
from ..schemas import EngineParams
from . import EngineResult, Formatted


class FakeEngine:
    def __init__(self, seconds: float, work_dir: Path, fail: bool = False):
        self.seconds = seconds
        self.work_dir = work_dir
        self.fail = fail  # next renders fail
        self.healthy = True
        self.format_fails = False
        self.submitted: list[EngineParams] = []
        self._tasks: dict[str, tuple[float, EngineParams, bool]] = {}

    async def aclose(self) -> None:
        pass

    async def submit(self, params: EngineParams) -> str:
        if not self.healthy:
            raise ApiError("engine_unavailable", "Fake engine is down.")
        task_id = uuid.uuid4().hex
        self._tasks[task_id] = (time.monotonic(), params, self.fail)
        self.submitted.append(params)
        return task_id

    async def query(self, task_id: str) -> EngineResult:
        if not self.healthy:
            raise ApiError("engine_unavailable", "Fake engine is down.")
        if task_id not in self._tasks:
            return EngineResult("failed", error="Engine no longer knows this task.")
        started, params, fail = self._tasks[task_id]
        if time.monotonic() - started < self.seconds:
            return EngineResult("running")
        if fail:
            return EngineResult("failed", error="Fake engine forced failure.")
        out = self.work_dir / f"{task_id}.flac"
        if not out.exists():
            await _tone(out, params.audio_duration)
        seed = params.seed if params.seed >= 0 else random.randrange(2**31)
        return EngineResult(
            "succeeded", audio_path=str(out), seed=seed, info={"dit": "fake", "lm": "fake"}
        )

    async def fetch_audio(self, path: str, dest: Path) -> None:
        await asyncio.to_thread(shutil.copyfile, path, dest)

    async def health(self) -> tuple[bool, list[str], str | None]:
        return (True, ["fake"], None) if self.healthy else (False, [], "Fake engine is down.")

    async def format_input(self, params: EngineParams) -> Formatted:
        if self.format_fails:
            raise ApiError("internal", "Fake format_input failed.")
        return Formatted(
            caption=params.prompt + ", planned",
            lyrics=params.lyrics or "[instrumental]",
            bpm=params.bpm or 72,
            key_scale=params.key_scale or "D minor",
            time_signature=params.time_signature or "4",
            vocal_language=params.vocal_language or "en",
        )


async def _tone(out: Path, seconds: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    part = out.with_suffix(".part.flac")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi",
        "-i", f"sine=frequency=220:sample_rate=44100:duration={seconds}",
        "-ac", "2", str(part),
        stderr=asyncio.subprocess.PIPE,
    )  # fmt: skip
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise ApiError("internal", f"Fake engine ffmpeg failed: {err.decode()[-200:]}")
    part.replace(out)
