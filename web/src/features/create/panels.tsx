// Builder panels (F1–F8, F10–F12). Each panel reads the spec and dispatches reducer actions.
import { useRef, useState, type Dispatch, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import type { BuilderSpec, Catalog, Frequency, Level, Preset, Role, TimeSignature } from '../../api/types'
import { FieldSeg } from '../../components/FieldSeg'
import { useMutation } from '../../lib/async'
import { formatDuration } from '../../lib/format'
import type { SpecAction, SpecErrors } from './specReducer'

export interface PanelProps {
  spec: BuilderSpec
  dispatch: Dispatch<SpecAction>
  catalog: Catalog
  errors: SpecErrors
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Panel({ id, label, title, children }: { id: string; label: string; title: string; children: ReactNode }) {
  return (
    <section className="card stack" aria-labelledby={id}>
      <div className="panel-head">
        <span className="label">{label}</span>
        <h2 id={id}>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Chips({ label, options, selected, onToggle }: {
  label: string; options: readonly string[]; selected: readonly string[]; onToggle: (v: string) => void
}) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="label" aria-hidden>{label}</span>
      <div className="chips">
        {options.map(o => (
          <button key={o} type="button" className="chip" aria-pressed={selected.includes(o)} onClick={() => onToggle(o)}>{o}</button>
        ))}
      </div>
    </div>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} className="field__error" role="alert">{message}</span> : null
}

/** Pick from the catalogue or type your own (deity, form). */
function ChoiceOrText({ label, options, value, onChange }: {
  label: string; options: readonly string[]; value: string | null; onChange: (v: string | null) => void
}) {
  const [customMode, setCustomMode] = useState(false)
  const custom = customMode || (value !== null && !options.includes(value))
  return (
    <div className="field">
      <label className="label" htmlFor={`pick-${label}`}>{label}</label>
      <select id={`pick-${label}`} className="select" value={custom ? '__custom' : value ?? ''}
        onChange={e => {
          const v = e.target.value
          setCustomMode(v === '__custom')
          onChange(v === '' || v === '__custom' ? null : v)
        }}>
        <option value="">None</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__custom">Other (type your own)</option>
      </select>
      {custom && (
        <input className="input" aria-label={`Custom ${label.toLowerCase()}`} placeholder={`Type a ${label.toLowerCase()}`}
          value={value ?? ''} maxLength={80} onChange={e => onChange(e.target.value || null)} />
      )}
    </div>
  )
}

/** Integer input where empty means null; keeps out-of-range values so validation can explain them. */
function numberOrNull(raw: string): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function StylePanel({ spec, dispatch, catalog }: PanelProps) {
  return (
    <Panel id="p-style" label="Style and mood" title="What should it feel like?">
      <label className="field">
        <span className="label">Title</span>
        <input className="input" value={spec.title} maxLength={200} placeholder="Om Namah Shivaya"
          onChange={e => dispatch({ type: 'set', key: 'title', value: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Style</span>
        <textarea className="textarea textarea--short" value={spec.style} maxLength={2000}
          placeholder="Deeply peaceful Shiva mantra meditation"
          onChange={e => dispatch({ type: 'set', key: 'style', value: e.target.value })} />
      </label>
      <Chips label="Mood" options={catalog.moods} selected={spec.moods}
        onToggle={value => dispatch({ type: 'toggle', list: 'moods', value })} />
      <div className="grid-2">
        <ChoiceOrText label="Deity or theme" options={catalog.deities} value={spec.theme.deity}
          onChange={deity => dispatch({ type: 'patch', section: 'theme', patch: { deity } })} />
        <ChoiceOrText label="Form" options={catalog.forms} value={spec.theme.form}
          onChange={form => dispatch({ type: 'patch', section: 'theme', patch: { form } })} />
      </div>
    </Panel>
  )
}

export function VocalsPanel({ spec, dispatch, catalog }: PanelProps) {
  const v = spec.vocals
  const types = ['none' as const, ...catalog.vocal_types.filter(t => t !== 'none')]
  const patch = (p: Partial<BuilderSpec['vocals']>) => dispatch({ type: 'patch', section: 'vocals', patch: p })
  return (
    <Panel id="p-vocals" label="Vocals" title="Who sings?">
      <FieldSeg label="Vocal type" options={types} value={v.type} onChange={type => patch({ type })} />
      {v.type === 'none' ? (
        <p>Instrumental: no vocals will be generated.</p>
      ) : (
        <>
          <Chips label="Character" options={catalog.vocal_characters} selected={v.character}
            onToggle={value => dispatch({ type: 'toggle', list: 'character', value })} />
          <FieldSeg label="Delivery" options={catalog.vocal_deliveries} value={v.delivery} onChange={delivery => patch({ delivery })} />
          <div className="grid-2">
            <label className="field">
              <span className="label">Notes</span>
              <input className="input" value={v.notes} placeholder="e.g. gentle, close-mic" onChange={e => patch({ notes: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Language</span>
              <select className="select" value={v.language ?? ''} onChange={e => patch({ language: e.target.value || null })}>
                <option value="">Auto</option>
                {catalog.languages.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
    </Panel>
  )
}

export function InstrumentsPanel({ spec, dispatch, catalog, errors }: PanelProps) {
  const [q, setQ] = useState('')
  const dragFrom = useRef<number | null>(null)
  const have = new Set(spec.instruments.map(i => i.name.toLowerCase()))
  const needle = q.trim().toLowerCase()
  const suggestions = catalog.instruments
    .filter(i => !have.has(i.name.toLowerCase()))
    .filter(i => !needle || i.name.toLowerCase().includes(needle) || i.tags.some(t => t.toLowerCase().includes(needle)))
    .slice(0, 8)
  const full = spec.instruments.length >= 40

  const add = (name: string, role: Role) => {
    const n = name.trim()
    if (!n || have.has(n.toLowerCase()) || full) return
    dispatch({ type: 'addInstrument', instrument: { name: n, role, level: 'present', frequency: role === 'accent' ? 'occasional' : null } })
    setQ('')
  }
  const addTyped = () => {
    const known = catalog.instruments.find(i => i.name.toLowerCase() === needle)
    add(known?.name ?? q, known?.default_role ?? 'supporting')
  }
  const move = (from: number, to: number) => dispatch({ type: 'moveInstrument', from, to })

  return (
    <Panel id="p-instruments" label="Instruments" title="The arrangement">
      <div className="field">
        <label className="label" htmlFor="ins-search">Add instrument</label>
        <div className="row row--nowrap">
          <input id="ins-search" className="input" value={q} placeholder="Search or type any instrument"
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped() } }} />
          <button type="button" className="btn btn--ghost" onClick={addTyped} disabled={!needle || full}>
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="chips" aria-label="Suggestions">
            {suggestions.map(i => (
              <button key={i.name} type="button" className="chip" disabled={full} onClick={() => add(i.name, i.default_role)}>
                <Plus size={14} aria-hidden /> {i.name}
              </button>
            ))}
          </div>
        )}
        <FieldError id="ins-err" message={errors.instruments} />
      </div>

      {spec.instruments.length === 0 ? (
        <p>No instruments yet. Leave it empty and the engine picks an arrangement from the style.</p>
      ) : (
        <ol className="ins-list">
          {spec.instruments.map((ins, i) => (
            <li key={`${ins.name}-${i}`} className="ins" draggable
              onDragStart={e => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (dragFrom.current !== null) move(dragFrom.current, i); dragFrom.current = null }}>
              <GripVertical size={16} className="ins__grip" aria-hidden />
              <strong className="ins__name">{ins.name}</strong>
              <select className="select" aria-label={`${ins.name} role`} value={ins.role}
                onChange={e => dispatch({ type: 'updateInstrument', index: i, patch: { role: e.target.value as Role } })}>
                {catalog.roles.map(r => <option key={r} value={r}>{sentence(r)}</option>)}
              </select>
              <select className="select" aria-label={`${ins.name} level`} value={ins.level}
                onChange={e => dispatch({ type: 'updateInstrument', index: i, patch: { level: e.target.value as Level } })}>
                {catalog.levels.map(l => <option key={l} value={l}>{sentence(l)}</option>)}
              </select>
              {ins.role === 'accent' && (
                <select className="select" aria-label={`${ins.name} frequency`} value={ins.frequency ?? 'occasional'}
                  onChange={e => dispatch({ type: 'updateInstrument', index: i, patch: { frequency: e.target.value as Frequency } })}>
                  {catalog.frequencies.map(f => <option key={f} value={f}>{sentence(f)}</option>)}
                </select>
              )}
              <span className="ins__actions">
                <button type="button" className="btn btn--icon btn--ghost" aria-label={`Move ${ins.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp size={16} aria-hidden />
                </button>
                <button type="button" className="btn btn--icon btn--ghost" aria-label={`Move ${ins.name} down`}
                  disabled={i === spec.instruments.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDown size={16} aria-hidden />
                </button>
                <button type="button" className="btn btn--icon btn--ghost" aria-label={`Remove ${ins.name}`}
                  onClick={() => dispatch({ type: 'removeInstrument', index: i })}>
                  <X size={16} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

export function AmbiencePanel({ spec, dispatch, catalog }: PanelProps) {
  const patch = (p: Partial<BuilderSpec['ambience']>) => dispatch({ type: 'patch', section: 'ambience', patch: p })
  return (
    <Panel id="p-ambience" label="Ambience" title="Space and dynamics">
      <FieldSeg label="Reverb" options={catalog.reverbs} value={spec.ambience.reverb} onChange={reverb => patch({ reverb })} />
      <FieldSeg label="Space" options={catalog.spaces} value={spec.ambience.space} onChange={space => patch({ space })} />
      <FieldSeg label="Dynamics" options={catalog.dynamics} value={spec.ambience.dynamics} onChange={dynamics => patch({ dynamics })} />
    </Panel>
  )
}

export function AvoidPanel({ spec, dispatch, catalog }: PanelProps) {
  const [text, setText] = useState('')
  const custom = spec.avoid.filter(a => !catalog.avoid_chips.includes(a))
  const add = () => { dispatch({ type: 'add', list: 'avoid', value: text }); setText('') }
  return (
    <Panel id="p-avoid" label="Avoid" title="Keep these out">
      <Chips label="Common" options={catalog.avoid_chips} selected={spec.avoid}
        onToggle={value => dispatch({ type: 'toggle', list: 'avoid', value })} />
      {custom.length > 0 && (
        <div className="chips" aria-label="Your additions">
          {custom.map(a => (
            <button key={a} type="button" className="chip" aria-pressed="true" aria-label={`Remove ${a}`}
              onClick={() => dispatch({ type: 'toggle', list: 'avoid', value: a })}>
              {a} <X size={14} aria-hidden />
            </button>
          ))}
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="avoid-add">Add your own</label>
        <div className="row row--nowrap">
          <input id="avoid-add" className="input" value={text} placeholder="e.g. electric guitar" maxLength={80}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
          <button type="button" className="btn btn--ghost" onClick={add} disabled={!text.trim()}>
            <Plus size={16} aria-hidden /> Add
          </button>
        </div>
      </div>
      <p className="field__help">Sent as the negative prompt, not mentioned in the caption.</p>
    </Panel>
  )
}

export function MusicPanel({ spec, dispatch, catalog, errors }: PanelProps) {
  const m = spec.music
  const patch = (p: Partial<BuilderSpec['music']>) => dispatch({ type: 'patch', section: 'music', patch: p })
  return (
    <Panel id="p-music" label="Music" title="Tempo, key and metre">
      <div className="grid-2">
        <label className="field">
          <span className="label">BPM</span>
          <input className="input" type="number" inputMode="numeric" min={30} max={300} step={1} placeholder="Auto"
            value={m.bpm ?? ''} aria-invalid={errors.bpm ? true : undefined} aria-describedby="bpm-err"
            onChange={e => patch({ bpm: numberOrNull(e.target.value) })} />
          <FieldError id="bpm-err" message={errors.bpm} />
        </label>
        <label className="field">
          <span className="label">Key</span>
          <select className="select" value={m.key ?? ''} onChange={e => patch({ key: e.target.value || null })}>
            <option value="">Auto</option>
            {catalog.keys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      </div>
      <FieldSeg label="Time signature" options={['auto', ...catalog.time_signatures]} value={m.time_signature ?? 'auto'}
        format={t => (t === 'auto' ? 'Auto' : `${t}/4`)}
        onChange={t => patch({ time_signature: t === 'auto' ? null : t as TimeSignature })} />
    </Panel>
  )
}

const TAGS = ['verse', 'chorus', 'bridge', 'instrumental'] as const

export function LyricsPanel({ spec, dispatch, errors }: PanelProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const patch = (p: Partial<BuilderSpec['lyrics']>) => dispatch({ type: 'patch', section: 'lyrics', patch: p })
  const insert = (tag: string) => {
    const el = ref.current
    const text = spec.lyrics.text
    const at = el?.selectionStart ?? text.length
    const before = text.slice(0, at)
    const snippet = `${before && !before.endsWith('\n') ? '\n' : ''}[${tag}]\n`
    patch({ text: before + snippet + text.slice(at) })
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + snippet.length, at + snippet.length) })
  }
  return (
    <Panel id="p-lyrics" label="Lyrics" title="Words, in any script">
      <div className="chips" role="group" aria-label="Insert section tag">
        {TAGS.map(t => (
          <button key={t} type="button" className="chip" onClick={() => insert(t)}>[{t}]</button>
        ))}
      </div>
      <label className="field">
        <span className="label">Lyrics</span>
        <textarea ref={ref} className="textarea lyrics" value={spec.lyrics.text} lang={spec.vocals.language ?? undefined}
          placeholder={'ॐ नमः शिवाय\nLeave empty to let the engine write lyrics.'} spellCheck={false}
          onChange={e => patch({ text: e.target.value })} />
      </label>
      <label className="field field--inline">
        <span className="label">Repeat lyrics</span>
        <input className="input input--narrow" type="number" inputMode="numeric" min={1} max={1000} placeholder="Off"
          value={spec.lyrics.repeat ?? ''} aria-invalid={errors.repeat || errors.lyrics ? true : undefined} aria-describedby="repeat-help"
          onChange={e => patch({ repeat: numberOrNull(e.target.value) })} />
        <span id="repeat-help" className={errors.repeat || errors.lyrics ? 'field__error' : 'field__help'}>
          {errors.repeat ?? errors.lyrics ?? 'Writes the lyrics out this many times, one per line. The sung count is approximate.'}
        </span>
      </label>
    </Panel>
  )
}

export function LengthPanel({ spec, dispatch, catalog, errors }: PanelProps) {
  const t = spec.length.total_seconds
  const set = (total_seconds: number) => dispatch({ type: 'patch', section: 'length', patch: { total_seconds } })
  return (
    <Panel id="p-length" label="Length" title={Number.isFinite(t) ? formatDuration(t) : 'Length'}>
      <div className="row">
        {[300, 600].map(s => (
          <button key={s} type="button" className="chip" aria-pressed={t === s} onClick={() => set(s)}>{formatDuration(s)}</button>
        ))}
      </div>
      <div className="row row--nowrap">
        <input className="range" type="range" min={10} max={600} step={5} value={Number.isFinite(t) ? t : 180}
          aria-label="Length in seconds" aria-valuetext={formatDuration(t)} onChange={e => set(Number(e.target.value))} />
        <input className="input input--narrow" type="number" inputMode="numeric" min={10} max={600} aria-label="Seconds"
          value={Number.isFinite(t) ? t : ''} aria-invalid={errors.duration ? true : undefined}
          onChange={e => set(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
        <span className="muted">s</span>
      </div>
      <FieldError id="len-err" message={errors.duration} />
      {t > catalog.lm_cap_seconds && (
        <p className="note">
          Above this Mac's {formatDuration(catalog.lm_cap_seconds)} LM cap: lyrics and metadata are planned first,
          then the song renders with the LM off.
        </p>
      )}
    </Panel>
  )
}

export function AdvancedPanel({ spec, dispatch, errors }: PanelProps) {
  const e = spec.engine
  const patch = (p: Partial<BuilderSpec['engine']>) => dispatch({ type: 'patch', section: 'engine', patch: p })
  return (
    <details className="card advanced">
      <summary>
        <span className="panel-head">
          <span className="label">Advanced</span>
          <h2>Engine options</h2>
        </span>
      </summary>
      <div className="stack advanced__body">
        <FieldSeg label="LM planning" options={['auto', 'on', 'off'] as const} value={e.lm} onChange={lm => patch({ lm })} />
        <label className="check">
          <input type="checkbox" checked={e.keep_caption} onChange={ev => patch({ keep_caption: ev.target.checked })} />
          Keep caption verbatim (skip LM rewriting)
        </label>
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="seed">Seed</label>
            <div className="row row--nowrap">
              <input id="seed" className="input" type="number" inputMode="numeric" step={1} placeholder="Random"
                value={e.seed ?? ''} onChange={ev => {
                  const n = numberOrNull(ev.target.value)
                  patch({ seed: n === null ? null : Math.trunc(n) })
                }} />
              <button type="button" className="btn btn--ghost" onClick={() => patch({ seed: null })} disabled={e.seed === null}>Random</button>
            </div>
          </div>
          <label className="field">
            <span className="label">LM temperature</span>
            <input className="input" type="number" inputMode="decimal" min={0} max={2} step={0.05} placeholder="Default"
              value={e.lm_temperature ?? ''} aria-invalid={errors.temperature ? true : undefined}
              onChange={ev => patch({ lm_temperature: numberOrNull(ev.target.value) })} />
            <FieldError id="temp-err" message={errors.temperature} />
          </label>
        </div>
      </div>
    </details>
  )
}

/** Quick start: tap a card to load its settings. */
export function PresetPicker({ presets, selectedId, onPick }: {
  presets: Preset[]; selectedId: string | null; onPick: (p: Preset) => void
}) {
  const builtin = presets.filter(p => p.builtin)
  const mine = presets.filter(p => !p.builtin)
  const group = (title: string, items: Preset[]) => items.length > 0 && (
    <div className="field" role="group" aria-label={title}>
      <span className="label" aria-hidden>{title}</span>
      <div className="preset-grid">
        {items.map(p => (
          <button key={p.id} type="button" className="preset" aria-pressed={p.id === selectedId} onClick={() => onPick(p)}>
            <span className="preset__name">{p.name}</span>
            {p.spec.style && <span className="preset__style">{p.spec.style}</span>}
            <span className="label">
              {formatDuration(p.spec.length.total_seconds)} · {p.spec.vocals.type === 'none' ? 'instrumental' : `${p.spec.vocals.type} vocal`}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <div className="stack">
      {group('Starters', builtin)}
      {group('My presets', mine)}
    </div>
  )
}

/** Save the current settings as a new preset, or overwrite / delete the loaded one of yours. */
export function SavePresetPanel({ spec, loaded, onChanged }: {
  spec: BuilderSpec; loaded: Preset | undefined; onChanged: (selectId: string | null) => void
}) {
  const [name, setName] = useState('')
  const op = useMutation((fn: () => Promise<unknown>) => fn())
  const busy = op.state.status === 'loading'
  const mine = loaded && !loaded.builtin ? loaded : undefined
  const run = async (fn: () => Promise<string | null>) => {
    const id = await op.mutate(fn)
    if (id !== undefined) onChanged(id as string | null)
  }
  return (
    <details className="save">
      <summary className="label">Save as preset</summary>
      <div className="stack save__body">
        <div className="field">
          <label className="label" htmlFor="preset-name">Preset name</label>
          <div className="row row--nowrap">
            <input id="preset-name" className="input" value={name} maxLength={120} placeholder="e.g. Morning mantra"
              onChange={e => setName(e.target.value)} />
            <button type="button" className="btn btn--ghost" disabled={!name.trim() || busy}
              onClick={() => run(async () => {
                const p = await api.createPreset(name.trim(), spec)
                setName('')
                return p.id
              })}>
              {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <Save size={16} aria-hidden />} Save
            </button>
          </div>
        </div>
        {mine && (
          <div className="row">
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
              onClick={() => run(async () => { await api.updatePreset(mine.id, mine.name, spec); return mine.id })}>
              <Save size={16} aria-hidden /> Update “{mine.name}”
            </button>
            <button type="button" className="btn btn--danger btn--sm" disabled={busy}
              onClick={() => {
                if (!confirm(`Delete preset “${mine.name}”?`)) return
                void run(async () => { await api.deletePreset(mine.id); return null })
              }}>
              <Trash2 size={16} aria-hidden /> Delete
            </button>
          </div>
        )}
        {op.state.status === 'error' && <p className="field__error" role="alert">{op.state.error.message}</p>}
        {op.state.status === 'success' && <p className="field__help" role="status">Saved.</p>}
      </div>
    </details>
  )
}
