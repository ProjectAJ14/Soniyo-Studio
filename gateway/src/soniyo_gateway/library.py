"""Songs and presets: CRUD, storage accounting, file deletion."""

import shutil
import uuid
from pathlib import Path

from . import jobs
from .catalog import BUILTIN_PRESETS
from .config import Settings
from .errors import ApiError
from .repo import Repo
from .schemas import BuilderSpec, Job, Preset, PresetIn, Song, SongList, SongPatch, Storage


def storage(repo: Repo, settings: Settings) -> Storage:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return Storage(
        used_bytes=repo.library_bytes(), free_bytes=shutil.disk_usage(settings.data_dir).free
    )


def list_songs(repo: Repo, settings: Settings, q: str, favourite: bool | None,
               limit: int) -> SongList:  # fmt: skip
    return SongList(items=repo.list_songs(q.strip(), favourite, limit),
                    storage=storage(repo, settings))  # fmt: skip


def get_song(repo: Repo, song_id: str) -> Song:
    song = repo.get_song(song_id)
    if song is None:
        raise ApiError("not_found", "No such song.")
    return song


def patch_song(repo: Repo, song_id: str, patch: SongPatch) -> Song:
    get_song(repo, song_id)
    fields: dict = {}
    if patch.title is not None:
        fields["title"] = patch.title.strip() or "Untitled"
    if patch.favourite is not None:
        fields["favourite"] = int(patch.favourite)
    repo.update_song(song_id, **fields)
    return get_song(repo, song_id)


def delete_song(repo: Repo, song_id: str) -> None:
    get_song(repo, song_id)
    paths = repo.song_paths(song_id) or ()
    repo.delete_song(song_id)
    for p in paths:
        Path(p).unlink(missing_ok=True)


def audio_path(repo: Repo, song_id: str, fmt: str) -> tuple[Song, Path]:
    song = get_song(repo, song_id)
    flac, mp3 = repo.song_paths(song_id) or ("", "")
    path = Path(flac if fmt == "flac" else mp3)
    if not path.is_file():
        raise ApiError("not_found", "The audio file for this song is missing on the Mac.")
    return song, path


def regenerate(repo: Repo, song_id: str, seed: str) -> Job:
    song = get_song(repo, song_id)
    engine = song.spec.engine.model_copy(update={"seed": song.seed if seed == "same" else None})
    return jobs.resubmit(repo, song.spec.model_copy(update={"engine": engine}))


# ---- presets ------------------------------------------------------------------------------


def seed_builtin_presets(repo: Repo) -> None:
    for preset_id, name, spec in BUILTIN_PRESETS:
        repo.upsert_builtin_preset(preset_id, name, spec)


def get_preset(repo: Repo, preset_id: str) -> Preset:
    preset = repo.get_preset(preset_id)
    if preset is None:
        raise ApiError("not_found", "No such preset.")
    return preset


def _mutable(repo: Repo, preset_id: str) -> None:
    if get_preset(repo, preset_id).builtin:
        raise ApiError("conflict", "Built-in presets cannot be changed. Save a copy instead.")


def create_preset(repo: Repo, body: PresetIn) -> Preset:
    preset_id = uuid.uuid4().hex
    repo.insert_preset(preset_id, body.name.strip(), _clean(body))
    return get_preset(repo, preset_id)


def update_preset(repo: Repo, preset_id: str, body: PresetIn) -> Preset:
    _mutable(repo, preset_id)
    repo.update_preset(preset_id, body.name.strip(), _clean(body))
    return get_preset(repo, preset_id)


def delete_preset(repo: Repo, preset_id: str) -> None:
    _mutable(repo, preset_id)
    repo.delete_preset(preset_id)


def _clean(body: PresetIn) -> BuilderSpec:
    return body.spec.model_copy(update={"client_job_id": None})
