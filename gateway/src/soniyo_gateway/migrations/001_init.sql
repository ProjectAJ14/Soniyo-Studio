-- Forward-only. Never edit an applied migration; add 002_*.sql.
CREATE TABLE jobs (
  id              TEXT PRIMARY KEY,
  client_job_id   TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  state           TEXT NOT NULL,
  spec            TEXT NOT NULL,          -- BuilderSpec JSON
  compiled        TEXT,                   -- CompileResult JSON
  engine_task_id  TEXT,
  error           TEXT,                   -- ErrorBody JSON
  timings         TEXT NOT NULL DEFAULT '{}',
  estimate_seconds REAL,
  song_id         TEXT,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX jobs_state ON jobs(state, created_at);

CREATE TABLE songs (
  id               TEXT PRIMARY KEY,
  job_id           TEXT NOT NULL REFERENCES jobs(id),
  title            TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  favourite        INTEGER NOT NULL DEFAULT 0,
  preset_id        TEXT,
  spec             TEXT NOT NULL,
  compiled         TEXT NOT NULL,
  seed             INTEGER,
  engine_info      TEXT NOT NULL DEFAULT '{}',
  flac_path        TEXT NOT NULL,
  mp3_path         TEXT NOT NULL,
  size_bytes       INTEGER NOT NULL
);
CREATE INDEX songs_created ON songs(created_at);

CREATE TABLE presets (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  builtin    INTEGER NOT NULL DEFAULT 0,
  spec       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
