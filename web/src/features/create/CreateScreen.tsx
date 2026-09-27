// The song builder (F1–F12, U1–U4, U8, U9). Two ways in: pick a preset (quick) or set everything yourself.
// Generate lives in the right rail (bottom bar on narrow screens); the caption preview folds away under it.
import { useEffect, useReducer, useRef, useState } from 'react'
import { Loader2, SlidersHorizontal, Sparkles, Wand2 } from 'lucide-react'
import { api } from '../../api/client'
import { emptySpec, type BuilderSpec, type Preset } from '../../api/types'
import { navigate } from '../../app/router'
import { AsyncView } from '../../components/AsyncView'
import { dataOf, useAsync, useMutation } from '../../lib/async'
import { takeDraft } from '../../lib/draft'
import { formatDuration } from '../../lib/format'
import { CompilePreview, useCompile } from './CompilePreview'
import {
  AdvancedPanel, AmbiencePanel, AvoidPanel, InstrumentsPanel, LengthPanel, LlmPresetPanel, LyricsPanel, MusicPanel,
  PresetPicker, SavePresetPanel, StylePanel, VocalsPanel,
} from './panels'
import { useConnection } from '../server/connection'
import { specReducer, validateSpec } from './specReducer'
import './create.css'

type Mode = 'preset' | 'custom'

/** `active` is false while another tab is showing: the screen stays mounted so your settings survive. */
export function CreateScreen({ active = true }: { active?: boolean }) {
  const [spec, dispatch] = useReducer(specReducer, undefined, emptySpec)
  // Bumped on every whole-spec load so panels drop local UI state (search text, custom modes).
  const [formKey, setFormKey] = useState(0)
  const [catalog, reloadCatalog] = useAsync(() => api.catalog(), [])
  const [presets, reloadPresets] = useAsync(() => api.listPresets(), [])
  const presetItems = dataOf(presets)?.items
  // Until you choose, start on presets when there are any.
  const [chosenMode, setMode] = useState<Mode | null>(null)
  const mode: Mode = chosenMode ?? (presets.status === 'success' && presetItems?.length === 0 ? 'custom' : 'preset')

  const load = (s: BuilderSpec) => {
    dispatch({ type: 'replace', spec: s })
    setFormKey(k => k + 1)
  }
  const pick = (p: Preset) => load({ ...p.spec, title: spec.title || p.spec.title, preset_id: p.id })
  const loaded = presetItems?.find(p => p.id === spec.preset_id)

  // U8: "Edit and regenerate" hands a spec over via lib/draft; consume it whenever this tab comes up.
  useEffect(() => {
    if (!active) return
    const draft = takeDraft()
    if (draft) {
      dispatch({ type: 'replace', spec: draft })
      setFormKey(k => k + 1) // oxlint-disable-line react/set-state-in-effect -- one-time draft hand-off
      setMode('custom')
    }
  }, [active])

  const errors = validateSpec(spec)
  const invalid = Object.keys(errors).length > 0
  const compiled = useCompile(spec)
  const caption = dataOf(compiled.state)?.caption

  // Same client_job_id for retries of the same spec, so a retry after a lost response is idempotent.
  const submission = useRef<{ spec: BuilderSpec; id: string } | null>(null)
  const generate = useMutation((body: BuilderSpec & { client_job_id: string }) => api.createJob(body))
  const submitting = generate.state.status === 'loading'
  // PRD: while the Mac is unreachable the builder keeps working; nothing is submitted.
  const offline = useConnection().status === 'unreachable'
  const onGenerate = async () => {
    if (invalid || submitting || offline) return
    if (submission.current?.spec !== spec) submission.current = { spec, id: crypto.randomUUID() }
    const job = await generate.mutate({ ...spec, client_job_id: submission.current.id })
    if (job) {
      submission.current = null
      navigate({ name: 'queue' })
    }
  }
  const genError = generate.state.status === 'error' ? generate.state.error : null

  return (
    <div>
      <div className="page-head">
        <div className="stack create__title">
          <span className="label">New song</span>
          <h1>Make a <em>song</em></h1>
        </div>
        <span className="spacer" />
        <div className="seg create__mode" role="group" aria-label="How do you want to start?">
          <button type="button" aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}>
            <Wand2 size={16} aria-hidden /> Quick start
          </button>
          <button type="button" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>
            <SlidersHorizontal size={16} aria-hidden /> Customize
          </button>
        </div>
      </div>
      <div className="create">
        <div className="stack create__builder">
          {mode === 'preset' && (
            <section className="card stack" aria-labelledby="p-presets">
              <div className="panel-head">
                <span className="label">Step 1</span>
                <h2 id="p-presets">Pick a starting point</h2>
              </div>
              <AsyncView state={presets} onRetry={reloadPresets} label="presets">
                {d => <PresetPicker presets={d.items} selectedId={spec.preset_id ?? null} onPick={pick} />}
              </AsyncView>
            </section>
          )}
          <AsyncView state={catalog} onRetry={reloadCatalog} label="song options">
            {c => {
              const props = { spec, dispatch, catalog: c, errors }
              // Outside the formKey remount, so its text and status survive the load it triggers.
              const ai = <LlmPresetPanel catalog={c} onCreated={s => { load(s); reloadPresets() }} />
              return <>{ai}{mode === 'preset' ? (
                <div className="stack" key={formKey}>
                  <section className="card stack" aria-labelledby="p-quick">
                    <div className="panel-head">
                      <span className="label">Step 2 · optional</span>
                      <h2 id="p-quick">Make it yours</h2>
                    </div>
                    <label className="field">
                      <span className="label">Title</span>
                      <input className="input" value={spec.title} maxLength={200} placeholder="Name your song"
                        onChange={e => dispatch({ type: 'set', key: 'title', value: e.target.value })} />
                    </label>
                  </section>
                  <LyricsPanel {...props} />
                  <LengthPanel {...props} />
                  <button type="button" className="btn btn--ghost" onClick={() => setMode('custom')}>
                    <SlidersHorizontal size={16} aria-hidden /> Fine-tune voice, instruments and more
                  </button>
                </div>
              ) : (
                <div className="stack" key={formKey}>
                  <StylePanel {...props} />
                  <VocalsPanel {...props} />
                  <InstrumentsPanel {...props} />
                  <LyricsPanel {...props} />
                  <LengthPanel {...props} />
                  <details className="card advanced">
                    <summary>
                      <span className="panel-head">
                        <span className="label">Optional</span>
                        <h2>Room, tempo and things to avoid</h2>
                      </span>
                    </summary>
                    <div className="stack advanced__body">
                      <AmbiencePanel {...props} />
                      <MusicPanel {...props} />
                      <AvoidPanel {...props} />
                    </div>
                  </details>
                  <AdvancedPanel {...props} />
                </div>
              )}</>
            }}
          </AsyncView>
        </div>

        <aside className="create__rail card stack" aria-label="Summary and generate">
          <div className="stack rail__summary">
            <h2>{spec.title.trim() || 'Untitled song'}</h2>
            <span className="label">
              {loaded ? `${loaded.name} · ` : ''}{formatDuration(spec.length.total_seconds)} · {spec.vocals.type === 'none' ? 'instrumental' : `${spec.vocals.type} vocal`}
            </span>
          </div>
          <div className="stack rail__go">
            {/* Narrow screens only: the preview is far below, so the bottom bar carries a one-line caption. */}
            <p className="rail__status mono" data-testid="go-status" aria-hidden>
              {invalid ? 'Fix the highlighted fields' : compiled.state.status === 'loading' ? 'Updating preview…'
                : compiled.state.status === 'error' ? 'Preview unavailable' : caption || 'Ready'}
            </p>
            <button type="button" className="btn btn--brand btn--block btn--lg" onClick={onGenerate} disabled={invalid || submitting || offline}
              aria-describedby={offline ? 'go-offline' : undefined}>
              {submitting ? <Loader2 size={18} className="spin" aria-hidden /> : <Sparkles size={18} aria-hidden />}
              {submitting ? 'Sending…' : genError ? 'Try again' : 'Generate'}
            </button>
            {offline && (
              <p id="go-offline" className="field__error" role="status">
                Your Mac is unreachable. Keep editing; Generate comes back once it answers.
              </p>
            )}
            {invalid && <p className="field__error">Fix the highlighted fields first.</p>}
            {genError && (
              <p className="field__error" role="alert">
                {genError.kind === 'unreachable'
                  ? "Can't reach your Mac, so the song isn't queued yet. Your settings are kept here; trying again won't create a duplicate."
                  : genError.message}
              </p>
            )}
          </div>
          <details className="save rail__preview">
            <summary className="label">What the engine will get</summary>
            <div className="save__body">
              <CompilePreview spec={spec} dispatch={dispatch} compiled={compiled} />
            </div>
          </details>
          <SavePresetPanel spec={spec} loaded={loaded} onChanged={id => {
            reloadPresets()
            if (id !== (spec.preset_id ?? null)) dispatch({ type: 'replace', spec: { ...spec, preset_id: id } })
          }} />
        </aside>
      </div>
    </div>
  )
}
