"""ffmpeg/ffprobe via asyncio subprocess, and Range-capable file responses."""

import asyncio
import re
from pathlib import Path

from fastapi.responses import FileResponse

from .errors import ApiError

MEDIA_TYPES = {"mp3": "audio/mpeg", "flac": "audio/flac"}


async def _run(*args: str) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
    except FileNotFoundError as e:
        raise ApiError("internal", f"{args[0]} is not installed on the Mac.", False) from e
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise ApiError("internal", f"{args[0]} failed: {err.decode(errors='replace')[-300:]}")
    return out.decode()


async def encode_mp3(src: Path, dest: Path) -> None:
    part = dest.with_suffix(".part.mp3")
    await _run("ffmpeg", "-y", "-v", "error", "-i", str(src),
               "-codec:a", "libmp3lame", "-b:a", "192k", str(part))  # fmt: skip
    part.replace(dest)


async def probe_duration(path: Path) -> float:
    out = await _run("ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(path))  # fmt: skip
    try:
        return round(float(out.strip()), 3)
    except ValueError as e:
        raise ApiError("internal", f"ffprobe gave no duration for {path.name}.") from e


def safe_filename(title: str, ext: str) -> str:
    """Title -> a filename with no path separators, quotes or control characters."""
    name = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]+', " ", title)
    name = re.sub(r"\s+", " ", name).strip(" .")[:100]
    return f"{name or 'song'}.{ext}"


def file_response(path: Path, fmt: str, download_name: str | None) -> FileResponse:
    """Starlette's FileResponse honours Range (206 / 416) and sets Accept-Ranges."""
    return FileResponse(
        path,
        media_type=MEDIA_TYPES[fmt],
        filename=download_name,
        content_disposition_type="attachment",
    )
