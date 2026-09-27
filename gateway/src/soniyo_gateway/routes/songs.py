from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import FileResponse

from .. import audio, library
from ..auth import require_token, require_token_or_query
from ..errors import ApiError
from ..schemas import Job, RegenerateRequest, Song, SongList, SongPatch
from . import Rt

router = APIRouter(prefix="/songs")
authed = [Depends(require_token)]


@router.get("", dependencies=authed)
def list_songs(rt: Rt, q: str = "", favourite: bool | None = None,
               limit: int = Query(100, ge=1, le=500)) -> SongList:  # fmt: skip
    return library.list_songs(rt.repo, rt.settings, q, favourite, limit)


@router.get("/{song_id}", dependencies=authed)
def get_song(song_id: str, rt: Rt) -> Song:
    return library.get_song(rt.repo, song_id)


@router.patch("/{song_id}", dependencies=authed)
def patch_song(song_id: str, patch: SongPatch, rt: Rt) -> Song:
    return library.patch_song(rt.repo, song_id, patch)


@router.delete("/{song_id}", status_code=204, dependencies=authed)
def delete_song(song_id: str, rt: Rt) -> Response:
    library.delete_song(rt.repo, song_id)
    return Response(status_code=204)


@router.get("/{song_id}/audio", dependencies=[Depends(require_token_or_query)])
def song_audio(song_id: str, rt: Rt, request: Request, format: Literal["mp3", "flac"] = "mp3",
               download: bool = False) -> FileResponse:  # fmt: skip
    song, path = library.audio_path(rt.repo, song_id, format)
    start = audio.range_start(request.headers.get("range"))
    if start is not None and start >= path.stat().st_size:
        raise ApiError("range_not_satisfiable", "The requested range is past the end of the file.")
    name = audio.safe_filename(song.title, format) if download else None
    return audio.file_response(path, format, name)


@router.post("/{song_id}/regenerate", status_code=202, dependencies=authed)
def regenerate(song_id: str, rt: Rt, body: RegenerateRequest | None = None) -> Job:
    return library.regenerate(rt.repo, song_id, (body or RegenerateRequest()).seed)
