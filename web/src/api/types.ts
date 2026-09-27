// Wire types for /api/v1. Mirror of docs/api-contract.md and gateway schemas.py.
// snake_case on purpose: no renaming layer between wire and UI.

export type VocalType = 'none' | 'female' | 'male' | 'duet' | 'choir'
export type Delivery = 'chant' | 'sing' | 'hum'
export type Role = 'drone' | 'lead' | 'supporting' | 'background' | 'accent'
export type Level = 'very soft' | 'soft' | 'present' | 'prominent'
export type Frequency = 'rare' | 'occasional' | 'regular'
export type Reverb = 'dry' | 'light' | 'medium' | 'deep'
export type Space = 'intimate' | 'room' | 'hall' | 'spacious'
export type Dynamics = 'steady' | 'gentle swells' | 'building'
export type JobState =
  | 'queued'
  | 'compiling'
  | 'generating'
  | 'unit_ready'
  | 'looping'
  | 'encoding'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export const TERMINAL_STATES: readonly JobState[] = ['succeeded', 'failed', 'cancelled']

export interface Instrument {
  name: string
  role: Role
  level: Level
  frequency: Frequency | null
}

export interface BuilderSpec {
  client_job_id?: string | null
  title: string
  theme: { deity: string | null; form: string | null }
  style: string
  moods: string[]
  vocals: {
    type: VocalType
    character: string[]
    delivery: Delivery | null
    notes: string
    language: string | null
  }
  instruments: Instrument[]
  ambience: { reverb: Reverb; space: Space; dynamics: Dynamics }
  avoid: string[]
  music: { bpm: number | null; key: string | null; time_signature: string | null }
  lyrics: { text: string; repeat: number | null }
  length: { mode: 'single'; total_seconds: number }
  engine: {
    lm: 'auto' | 'on' | 'off'
    keep_caption: boolean
    seed: number | null
    lm_temperature: number | null
    caption_override: string | null
  }
}

export interface EngineParams {
  prompt: string
  lyrics: string
  lm_negative_prompt: string
  bpm: number | null
  key_scale: string
  time_signature: string
  audio_duration: number
  vocal_language: string
  thinking: boolean
  use_cot_caption: boolean
  seed: number
  lm_temperature: number
  batch_size: number
  inference_steps: number
  audio_format: string
}

export interface CompileResult {
  caption: string
  lyrics: string
  negative_prompt: string
  params: EngineParams
  plan: { lm_text_pass: boolean; lm_off_render: boolean; lm_cap_seconds: number }
  routing: { item: string; target: 'prompt' | 'lm_negative_prompt' }[]
  notes: string[]
}

export interface ErrorBody {
  code: string
  message: string
  retryable: boolean
}

export interface Job {
  id: string
  client_job_id: string
  title: string
  state: JobState
  position: number | null
  spec: BuilderSpec
  compiled: CompileResult | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  elapsed_seconds: number | null
  estimate_seconds_left: number | null
  timings: Record<string, number>
  error: ErrorBody | null
  song_id: string | null
}

export interface Song {
  id: string
  job_id: string
  title: string
  created_at: string
  duration_seconds: number
  favourite: boolean
  preset_id: string | null
  spec: BuilderSpec
  compiled: CompileResult
  seed: number | null
  engine_info: Record<string, string>
  size_bytes: number
}

export interface SongList {
  items: Song[]
  storage: { used_bytes: number; free_bytes: number }
}

export interface Preset {
  id: string
  name: string
  builtin: boolean
  spec: BuilderSpec
  created_at: string
  updated_at: string
}

export interface Health {
  status: 'ok'
  version: string
  engine?: {
    reachable: boolean
    status: 'ok' | 'down' | 'unknown'
    models: string[]
    last_error: string | null
  } | null
  queue_depth?: number | null
  running_job_id?: string | null
  disk?: {
    free_bytes: number
    total_bytes: number
    used_by_library_bytes: number
    low: boolean
  } | null
}

export interface Catalog {
  instruments: { name: string; default_role: Role; tags: string[] }[]
  roles: Role[]
  levels: Level[]
  frequencies: Frequency[]
  vocal_types: VocalType[]
  vocal_characters: string[]
  vocal_deliveries: Delivery[]
  languages: { code: string; name: string }[]
  moods: string[]
  deities: string[]
  forms: string[]
  avoid_chips: string[]
  reverbs: Reverb[]
  spaces: Space[]
  dynamics: Dynamics[]
  keys: string[]
  time_signatures: string[]
  lm_cap_seconds: number
}

/** Defaults matching the gateway's pydantic defaults, so `{}` and this compile the same. */
export function emptySpec(): BuilderSpec {
  return {
    title: '',
    theme: { deity: null, form: null },
    style: '',
    moods: [],
    vocals: { type: 'female', character: [], delivery: 'sing', notes: '', language: null },
    instruments: [],
    ambience: { reverb: 'medium', space: 'room', dynamics: 'steady' },
    avoid: [],
    music: { bpm: null, key: null, time_signature: null },
    lyrics: { text: '', repeat: null },
    length: { mode: 'single', total_seconds: 180 },
    engine: { lm: 'auto', keep_caption: false, seed: null, lm_temperature: null, caption_override: null },
  }
}
