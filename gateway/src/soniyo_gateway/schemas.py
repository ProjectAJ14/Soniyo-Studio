"""Wire types for /api/v1. Mirror of docs/api-contract.md and web/src/api/types.ts."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

VocalType = Literal["none", "female", "male", "duet", "choir"]
Delivery = Literal["chant", "sing", "hum"]
Role = Literal["drone", "lead", "supporting", "background", "accent"]
Level = Literal["very soft", "soft", "present", "prominent"]
Frequency = Literal["rare", "occasional", "regular"]
Reverb = Literal["dry", "light", "medium", "deep"]
Space = Literal["intimate", "room", "hall", "spacious"]
Dynamics = Literal["steady", "gentle swells", "building"]
JobState = Literal[
    "queued",
    "compiling",
    "generating",
    "unit_ready",
    "looping",
    "encoding",
    "succeeded",
    "failed",
    "cancelled",
]
TERMINAL_STATES: frozenset[str] = frozenset({"succeeded", "failed", "cancelled"})


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Theme(_Model):
    deity: str | None = None
    form: str | None = None


class Vocals(_Model):
    type: VocalType = "female"
    character: list[str] = Field(default_factory=list)
    delivery: Delivery | None = "sing"
    notes: str = ""
    language: str | None = None


class Instrument(_Model):
    name: str = Field(min_length=1, max_length=80)
    role: Role = "supporting"
    level: Level = "present"
    frequency: Frequency | None = None


class Ambience(_Model):
    reverb: Reverb = "medium"
    space: Space = "room"
    dynamics: Dynamics = "steady"


class Music(_Model):
    bpm: int | None = Field(default=None, ge=30, le=300)
    key: str | None = None
    time_signature: str | None = None


class Lyrics(_Model):
    text: str = ""
    repeat: int | None = Field(default=None, ge=1, le=1000)


class Length(_Model):
    mode: Literal["single"] = "single"  # "loop" arrives in v1.1
    total_seconds: int = Field(default=180, ge=10, le=600)


class EngineOptions(_Model):
    lm: Literal["auto", "on", "off"] = "auto"
    keep_caption: bool = False
    seed: int | None = None
    lm_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    caption_override: str | None = None


class BuilderSpec(_Model):
    client_job_id: str | None = None
    title: str = Field(default="", max_length=200)
    theme: Theme = Field(default_factory=Theme)
    style: str = Field(default="", max_length=2000)
    moods: list[str] = Field(default_factory=list)
    vocals: Vocals = Field(default_factory=Vocals)
    instruments: list[Instrument] = Field(default_factory=list, max_length=40)
    ambience: Ambience = Field(default_factory=Ambience)
    avoid: list[str] = Field(default_factory=list)
    music: Music = Field(default_factory=Music)
    lyrics: Lyrics = Field(default_factory=Lyrics)
    length: Length = Field(default_factory=Length)
    engine: EngineOptions = Field(default_factory=EngineOptions)


class EngineParams(_Model):
    prompt: str
    lyrics: str
    lm_negative_prompt: str
    bpm: int | None
    key_scale: str
    time_signature: str
    audio_duration: int
    vocal_language: str
    thinking: bool
    use_cot_caption: bool
    seed: int
    lm_temperature: float
    batch_size: int = 1
    inference_steps: int = 8
    audio_format: str = "flac"


class Plan(_Model):
    lm_text_pass: bool
    lm_off_render: bool
    lm_cap_seconds: int


class Routing(_Model):
    item: str
    target: Literal["prompt", "lm_negative_prompt"]


class CompileResult(_Model):
    caption: str
    lyrics: str
    negative_prompt: str
    params: EngineParams
    plan: Plan
    routing: list[Routing]
    notes: list[str]


class ErrorBody(_Model):
    code: str
    message: str
    retryable: bool


class Job(_Model):
    id: str
    client_job_id: str
    title: str
    state: JobState
    position: int | None
    spec: BuilderSpec
    compiled: CompileResult | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    elapsed_seconds: float | None
    estimate_seconds_left: float | None
    timings: dict[str, float]
    error: ErrorBody | None
    song_id: str | None


class JobList(_Model):
    items: list[Job]


class Song(_Model):
    id: str
    job_id: str
    title: str
    created_at: str
    duration_seconds: float
    favourite: bool
    preset_id: str | None
    spec: BuilderSpec
    compiled: CompileResult
    seed: int | None
    engine_info: dict[str, str]
    size_bytes: int


class Storage(_Model):
    used_bytes: int
    free_bytes: int


class SongList(_Model):
    items: list[Song]
    storage: Storage


class SongPatch(_Model):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    favourite: bool | None = None


class RegenerateRequest(_Model):
    seed: Literal["same", "new"] = "same"


class Preset(_Model):
    id: str
    name: str
    builtin: bool
    spec: BuilderSpec
    created_at: str
    updated_at: str


class PresetIn(_Model):
    name: str = Field(min_length=1, max_length=120)
    spec: BuilderSpec


class PresetList(_Model):
    items: list[Preset]


class EngineHealth(_Model):
    reachable: bool
    status: Literal["ok", "down", "unknown"]
    models: list[str]
    last_error: str | None


class Disk(_Model):
    free_bytes: int
    total_bytes: int
    used_by_library_bytes: int
    low: bool


class Health(_Model):
    status: Literal["ok"] = "ok"
    version: str
    engine: EngineHealth | None = None
    queue_depth: int | None = None
    running_job_id: str | None = None
    disk: Disk | None = None


class Language(_Model):
    code: str
    name: str


class CatalogInstrument(_Model):
    name: str
    default_role: Role
    tags: list[str]


class Catalog(_Model):
    instruments: list[CatalogInstrument]
    roles: list[str]
    levels: list[str]
    frequencies: list[str]
    vocal_types: list[str]
    vocal_characters: list[str]
    vocal_deliveries: list[str]
    languages: list[Language]
    moods: list[str]
    deities: list[str]
    forms: list[str]
    avoid_chips: list[str]
    reverbs: list[str]
    spaces: list[str]
    dynamics: list[str]
    keys: list[str]
    time_signatures: list[str]
    lm_cap_seconds: int
