// Round trip through any outside chat LLM: we copy a prompt that describes the BuilderSpec and this
// server's catalogue, the LLM answers with one JSON object, and the user pastes it back as a preset.
import type { BuilderSpec, Catalog } from '../../api/types'

const list = (xs: readonly string[]) => xs.join(' | ')

export function buildConfigPrompt(c: Catalog, idea: string): string {
  const shape = {
    title: 'short song title',
    theme: { deity: `${list(c.deities)} | other name | null`, form: `${list(c.forms)} | other | null` },
    style: 'one sentence describing the overall style and feel',
    moods: [`any of: ${list(c.moods)}`],
    vocals: {
      type: list(c.vocal_types),
      character: [`any of: ${list(c.vocal_characters)}`],
      delivery: `${list(c.vocal_deliveries)} | null`,
      notes: 'free text about pronunciation or singing, may be empty',
      language: `${list(c.languages.map(l => l.code))} | null`,
    },
    instruments: [{
      name: 'instrument name, prefer the list below',
      role: list(c.roles),
      level: list(c.levels),
      frequency: `${list(c.frequencies)} (only when role is accent, otherwise null)`,
    }],
    ambience: { reverb: list(c.reverbs), space: list(c.spaces), dynamics: list(c.dynamics) },
    avoid: [`things to keep out, e.g. ${list(c.avoid_chips)}`],
    music: { bpm: 'integer 30-300 | null', key: 'e.g. D major | null', time_signature: `${list(c.time_signatures)} | null` },
    lyrics: { text: 'lyrics, one line per line, in the script the singer should read', repeat: 'integer 1-1000 | null' },
    length: { mode: 'single', total_seconds: 'integer 10-600' },
    engine: { lm: 'auto', keep_caption: true, seed: null, lm_temperature: null, caption_override: null },
  }
  return [
    'You design settings for a devotional music generator (ACE-Step). Reply with ONE JSON object inside a single',
    '```json code block, and nothing outside it: no prose, no comments in the JSON.',
    'Use exactly this shape; "a | b" means pick one value.',
    '',
    JSON.stringify(shape, null, 2),
    '',
    'Instruments this server knows (name: usual role):',
    c.instruments.map(i => `${i.name}: ${i.default_role}`).join(', '),
    'Languages: ' + c.languages.map(l => `${l.code} = ${l.name}`).join(', '),
    '',
    'Rules: use only the listed values for fields with a fixed list; moods, avoid, instruments and deity/form may',
    `use other words if nothing fits. Songs longer than ${c.lm_cap_seconds} s are fine up to 600 s.`,
    'Write lyrics yourself unless the request gives them; keep lyrics.text under 20000 characters.',
    '',
    'The song I want:',
    idea.trim() || '(describe the song here)',
  ].join('\n')
}

/** Pulls the JSON object out of an LLM reply (tolerates code fences or chatter around it). */
export function parseSpecReply(reply: string): { spec: Partial<BuilderSpec> } | { error: string } {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return { error: 'No JSON object found. Paste the whole reply from the LLM.' }
  let value: unknown
  try {
    value = JSON.parse(reply.slice(start, end + 1))
  } catch (e) {
    return { error: `That JSON does not parse: ${(e as Error).message}` }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { error: 'Expected one JSON object.' }
  // The gateway fills every missing field with its default and rejects out-of-range values.
  const { client_job_id: _job, preset_id: _preset, ...spec } = value as Partial<BuilderSpec> & { client_job_id?: unknown }
  return { spec }
}
