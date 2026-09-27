// All builder form state lives in one reducer over the wire type, so what you see is what is sent.
import type { BuilderSpec, Instrument } from '../../api/types'

type Section = 'theme' | 'vocals' | 'ambience' | 'music' | 'lyrics' | 'length' | 'engine'
type ListKey = 'moods' | 'avoid' | 'character'

export type SpecAction =
  | { type: 'replace'; spec: BuilderSpec }
  | { type: 'set'; key: 'title' | 'style'; value: string }
  | { [K in Section]: { type: 'patch'; section: K; patch: Partial<BuilderSpec[K]> } }[Section]
  | { type: 'toggle'; list: ListKey; value: string }
  | { type: 'add'; list: ListKey; value: string }
  | { type: 'addInstrument'; instrument: Instrument }
  | { type: 'updateInstrument'; index: number; patch: Partial<Instrument> }
  | { type: 'removeInstrument'; index: number }
  | { type: 'moveInstrument'; from: number; to: number }

const getList = (s: BuilderSpec, l: ListKey) => (l === 'character' ? s.vocals.character : s[l])
const setList = (s: BuilderSpec, l: ListKey, v: string[]): BuilderSpec =>
  l === 'character' ? { ...s, vocals: { ...s.vocals, character: v } } : { ...s, [l]: v }

export function specReducer(s: BuilderSpec, a: SpecAction): BuilderSpec {
  switch (a.type) {
    case 'replace': {
      // A draft or preset may carry a stale client_job_id; a new submit always mints its own.
      const { client_job_id: _drop, ...rest } = structuredClone(a.spec)
      return rest
    }
    case 'set':
      return { ...s, [a.key]: a.value }
    case 'patch':
      return { ...s, [a.section]: { ...s[a.section], ...a.patch } }
    case 'toggle': {
      const cur = getList(s, a.list)
      return setList(s, a.list, cur.includes(a.value) ? cur.filter(x => x !== a.value) : [...cur, a.value])
    }
    case 'add': {
      const v = a.value.trim()
      const cur = getList(s, a.list)
      if (!v || cur.some(x => x.toLowerCase() === v.toLowerCase())) return s
      return setList(s, a.list, [...cur, v])
    }
    case 'addInstrument':
      return { ...s, instruments: [...s.instruments, a.instrument] }
    case 'updateInstrument':
      return {
        ...s,
        instruments: s.instruments.map((ins, i) => {
          if (i !== a.index) return ins
          const next = { ...ins, ...a.patch }
          // Frequency only means something for one-off accents (F4).
          if (next.role !== 'accent') next.frequency = null
          else if (next.frequency === null) next.frequency = 'occasional'
          return next
        }),
      }
    case 'removeInstrument':
      return { ...s, instruments: s.instruments.filter((_, i) => i !== a.index) }
    case 'moveInstrument': {
      const { from, to } = a
      if (from === to || to < 0 || to >= s.instruments.length || from < 0 || from >= s.instruments.length) return s
      const list = [...s.instruments]
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item)
      return { ...s, instruments: list }
    }
  }
}

export type SpecErrors = Partial<Record<'bpm' | 'duration' | 'repeat' | 'temperature' | 'instruments', string>>

/** Mirrors the gateway's pydantic bounds (schemas.py) so nothing invalid is sent. */
export function validateSpec(s: BuilderSpec): SpecErrors {
  const e: SpecErrors = {}
  const { bpm } = s.music
  if (bpm !== null && (!Number.isInteger(bpm) || bpm < 30 || bpm > 300)) e.bpm = 'BPM must be a whole number from 30 to 300.'
  const t = s.length.total_seconds
  if (!Number.isInteger(t) || t < 10 || t > 600) e.duration = 'Length must be between 0:10 and 10:00.'
  const r = s.lyrics.repeat
  if (r !== null && (!Number.isInteger(r) || r < 1 || r > 1000)) e.repeat = 'Repeat count must be from 1 to 1000.'
  const temp = s.engine.lm_temperature
  if (temp !== null && !(temp >= 0 && temp <= 2)) e.temperature = 'Temperature must be from 0 to 2.'
  if (s.instruments.length > 40) e.instruments = 'At most 40 instruments.'
  return e
}
