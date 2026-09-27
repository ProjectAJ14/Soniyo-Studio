"""The Engine protocol. Only worker.py (and main.py, to build one) touch this package."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol

from ..schemas import EngineParams


@dataclass
class EngineResult:
    status: Literal["running", "succeeded", "failed"]
    audio_path: str | None = None
    error: str | None = None
    seed: int | None = None
    info: dict[str, str] = field(default_factory=dict)  # {"dit": ..., "lm": ...} when known


@dataclass
class Formatted:
    """What the LM text pass (format_input) hands back; None/"" = engine left it empty."""

    caption: str = ""
    lyrics: str = ""
    bpm: int | None = None
    key_scale: str = ""
    time_signature: str = ""
    vocal_language: str = ""


class Engine(Protocol):
    async def submit(self, params: EngineParams) -> str: ...

    async def query(self, task_id: str) -> EngineResult: ...

    async def fetch_audio(self, path: str, dest: Path) -> None: ...

    async def health(self) -> tuple[bool, list[str], str | None]: ...

    async def format_input(self, params: EngineParams) -> Formatted: ...

    async def avg_job_seconds(self) -> float | None: ...

    async def aclose(self) -> None: ...
