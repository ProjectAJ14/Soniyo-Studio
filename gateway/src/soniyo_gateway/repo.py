"""All SQL. Rows map to schemas here; job writes publish to the events hub."""

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .db import now
from .events import Hub
from .schemas import BuilderSpec, CompileResult, ErrorBody, Preset, Song

_JSON_FIELDS = {"spec", "compiled", "error", "timings"}


def _enc(v: Any) -> Any:
    if hasattr(v, "model_dump_json"):
        return v.model_dump_json()
    if isinstance(v, dict):
        return json.dumps(v)
    return v


def _job(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["spec"] = BuilderSpec.model_validate_json(d["spec"])
    d["compiled"] = CompileResult.model_validate_json(d["compiled"]) if d["compiled"] else None
    d["error"] = ErrorBody.model_validate_json(d["error"]) if d["error"] else None
    d["timings"] = json.loads(d["timings"])
    return d


def _song(row: sqlite3.Row) -> Song:
    d = dict(row)
    return Song(
        **{k: d[k] for k in ("id", "job_id", "title", "created_at", "duration_seconds",
                             "preset_id", "seed", "size_bytes")},
        favourite=bool(d["favourite"]),
        spec=BuilderSpec.model_validate_json(d["spec"]),
        compiled=CompileResult.model_validate_json(d["compiled"]),
        engine_info=json.loads(d["engine_info"]),
    )  # fmt: skip


def _preset(row: sqlite3.Row) -> Preset:
    d = dict(row)
    return Preset(
        id=d["id"],
        name=d["name"],
        builtin=bool(d["builtin"]),
        spec=BuilderSpec.model_validate_json(d["spec"]),
        created_at=d["created_at"],
        updated_at=d["updated_at"],
    )


class _Result:
    """Rows fetched while the lock was held, so no cursor outlives it."""

    def __init__(self, cur: sqlite3.Cursor):
        self.rows = cur.fetchall()
        self.rowcount = cur.rowcount

    def fetchone(self) -> sqlite3.Row | None:
        return self.rows[0] if self.rows else None

    def __iter__(self):  # noqa: ANN204
        return iter(self.rows)


class Repo:
    def __init__(self, conn: sqlite3.Connection, hub: Hub):
        self.conn = conn
        self.hub = hub
        # Sync routes run in a threadpool and share this one connection with the worker;
        # sqlite3 connections are not safe for concurrent use, so every statement is serialised.
        self._lock = threading.Lock()

    def _execute(self, sql: str, args: Any = ()) -> _Result:
        with self._lock:
            return _Result(self.conn.execute(sql, args))

    # ---- jobs -------------------------------------------------------------------------

    def insert_job(self, id: str, client_job_id: str, title: str, spec: BuilderSpec) -> None:
        self._execute(
            "INSERT INTO jobs(id, client_job_id, title, state, spec, created_at)"
            " VALUES (?, ?, ?, 'queued', ?, ?)",
            (id, client_job_id, title, spec.model_dump_json(), now()),
        )
        self.hub.publish(id)

    def get_job(self, id: str) -> dict | None:
        row = self._execute("SELECT * FROM jobs WHERE id = ?", (id,)).fetchone()
        return _job(row) if row else None

    def get_job_by_client_id(self, client_job_id: str) -> dict | None:
        row = self._execute(
            "SELECT * FROM jobs WHERE client_job_id = ?", (client_job_id,)
        ).fetchone()
        return _job(row) if row else None

    def list_jobs(self, states: list[str] | None, limit: int) -> list[dict]:
        sql, args = "SELECT * FROM jobs", []
        if states:
            sql += f" WHERE state IN ({','.join('?' * len(states))})"
            args += states
        sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        return [_job(r) for r in self._execute(sql, [*args, limit])]

    def jobs_in_states(self, states: list[str]) -> list[dict]:
        q = f"SELECT * FROM jobs WHERE state IN ({','.join('?' * len(states))}) ORDER BY created_at"
        return [_job(r) for r in self._execute(q, states)]

    def queued_ids(self) -> list[str]:
        rows = self._execute(
            "SELECT id FROM jobs WHERE state = 'queued' ORDER BY created_at, rowid"
        )
        return [r[0] for r in rows]

    def update_job(self, id: str, *, only_from: tuple[str, ...] = (), **fields: Any) -> bool:
        """Set fields; with only_from, only if the current state is one of them. Publishes."""
        cols = ", ".join(f"{k} = ?" for k in fields)
        sql, args = f"UPDATE jobs SET {cols} WHERE id = ?", [_enc(v) for v in fields.values()]
        args.append(id)
        if only_from:
            sql += f" AND state IN ({','.join('?' * len(only_from))})"
            args += only_from
        changed = self._execute(sql, args).rowcount > 0
        if changed:
            self.hub.publish(id)
        return changed

    def generate_seconds_per_audio_second(self) -> float | None:
        """Running average of generate time / requested duration over succeeded jobs."""
        row = self._execute(
            "SELECT AVG(json_extract(timings, '$.generate')"
            "   / json_extract(spec, '$.length.total_seconds'))"
            " FROM jobs WHERE state = 'succeeded' AND json_extract(timings, '$.generate') > 0"
        ).fetchone()
        return row[0]

    # ---- songs ------------------------------------------------------------------------

    def finish_job(self, job_id: str, song: Song, flac_path: str, mp3_path: str,
                   timings: dict) -> None:  # fmt: skip
        """Insert the song and mark its job succeeded atomically, so a crash can never leave
        a song whose job recovery would render again."""
        with self._lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                self._insert_song(song, flac_path, mp3_path)
                self.conn.execute(
                    "UPDATE jobs SET state = 'succeeded', song_id = ?, finished_at = ?,"
                    " timings = ? WHERE id = ?",
                    (song.id, now(), json.dumps(timings), job_id),
                )
                self.conn.execute("COMMIT")
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
        self.hub.publish(job_id)

    def song_file_names(self) -> set[str]:
        rows = self._execute("SELECT flac_path, mp3_path FROM songs")
        return {Path(p).name for r in rows for p in r if p}

    def _insert_song(self, song: Song, flac_path: str, mp3_path: str) -> None:
        self.conn.execute(
            "INSERT INTO songs(id, job_id, title, created_at, duration_seconds, favourite,"
            " preset_id, spec, compiled, seed, engine_info, flac_path, mp3_path, size_bytes)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (song.id, song.job_id, song.title, song.created_at, song.duration_seconds,
             int(song.favourite), song.preset_id, song.spec.model_dump_json(),
             song.compiled.model_dump_json(), song.seed, json.dumps(song.engine_info),
             flac_path, mp3_path, song.size_bytes),
        )  # fmt: skip

    def get_song(self, id: str) -> Song | None:
        row = self._execute("SELECT * FROM songs WHERE id = ?", (id,)).fetchone()
        return _song(row) if row else None

    def song_paths(self, id: str) -> tuple[str, str] | None:
        row = self._execute(
            "SELECT flac_path, mp3_path FROM songs WHERE id = ?", (id,)
        ).fetchone()
        return (row[0], row[1]) if row else None

    def list_songs(self, q: str, favourite: bool | None, limit: int) -> list[Song]:
        sql, args = "SELECT * FROM songs WHERE 1=1", []
        if q:
            like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            sql += (
                " AND (title LIKE ? ESCAPE '\\'"
                " OR json_extract(spec, '$.style') LIKE ? ESCAPE '\\')"
            )
            args += [like, like]
        if favourite is not None:
            sql += " AND favourite = ?"
            args.append(int(favourite))
        sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
        return [_song(r) for r in self._execute(sql, [*args, limit])]

    def update_song(self, id: str, **fields: Any) -> None:
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            self._execute(f"UPDATE songs SET {cols} WHERE id = ?", [*fields.values(), id])

    def delete_song(self, id: str) -> None:
        # the job keeps its history but must not point at a gone song
        self._execute("UPDATE jobs SET song_id = NULL WHERE song_id = ?", (id,))
        self._execute("DELETE FROM songs WHERE id = ?", (id,))

    def library_bytes(self) -> int:
        return self._execute("SELECT COALESCE(SUM(size_bytes), 0) FROM songs").fetchone()[0]

    # ---- presets ----------------------------------------------------------------------

    def upsert_builtin_preset(self, id: str, name: str, spec: BuilderSpec) -> None:
        ts = now()
        self._execute(
            "INSERT INTO presets(id, name, builtin, spec, created_at, updated_at)"
            " VALUES (?, ?, 1, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET name = excluded.name, spec = excluded.spec,"
            " builtin = 1, updated_at = excluded.updated_at"
            " WHERE presets.name != excluded.name OR presets.spec != excluded.spec",
            (id, name, spec.model_dump_json(), ts, ts),
        )

    def insert_preset(self, id: str, name: str, spec: BuilderSpec) -> None:
        ts = now()
        self._execute(
            "INSERT INTO presets(id, name, builtin, spec, created_at, updated_at)"
            " VALUES (?, ?, 0, ?, ?, ?)",
            (id, name, spec.model_dump_json(), ts, ts),
        )

    def get_preset(self, id: str) -> Preset | None:
        row = self._execute("SELECT * FROM presets WHERE id = ?", (id,)).fetchone()
        return _preset(row) if row else None

    def list_presets(self) -> list[Preset]:
        rows = self._execute(
            "SELECT * FROM presets ORDER BY builtin DESC, created_at, name"
        )
        return [_preset(r) for r in rows]

    def update_preset(self, id: str, name: str, spec: BuilderSpec) -> None:
        self._execute(
            "UPDATE presets SET name = ?, spec = ?, updated_at = ? WHERE id = ?",
            (name, spec.model_dump_json(), now(), id),
        )

    def delete_preset(self, id: str) -> None:
        self._execute("DELETE FROM presets WHERE id = ?", (id,))
