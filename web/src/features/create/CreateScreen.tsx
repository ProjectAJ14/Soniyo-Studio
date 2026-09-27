// The song builder (F1–F12, U1–U4, U8, U9): builder panels on the left, live preview + Generate on the right.
import { useEffect, useReducer, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { api } from '../../api/client'
import { emptySpec, type BuilderSpec } from '../../api/types'
import { navigate } from '../../app/router'
import { AsyncView } from '../../components/AsyncView'
import { dataOf, useAsync, useMutation } from '../../lib/async'
import { takeDraft } from '../../lib/draft'
import { formatDuration } from '../../lib/format'
import { CompilePreview, useCompile } from './CompilePreview'
import {
  AdvancedPanel, AmbiencePanel, AvoidPanel, InstrumentsPanel, LengthPanel, LyricsPanel, MusicPanel,
  PresetPanel, StylePanel, VocalsPanel,
} from './panels'
import { specReducer, validateSpec } from './specReducer'
import './create.css'

export function CreateScreen() {
  const [spec, dispatch] = useReducer(specReducer, undefined, emptySpec)
  // Bumped on every whole-spec load so panels drop local UI state (search text, custom modes).
  const [formKey, setFormKey] = useState(0)
  const [catalog, reloadCatalog] = useAsync(() => api.catalog(), [])

  const load = (s: BuilderSpec) => {
    dispatch({ type: 'replace', spec: s })
    setFormKey(k => k + 1)
  }

  // U8: "Edit and regenerate" hands a spec over via lib/draft; consume it once on mount.
  useEffect(() => {
    const draft = takeDraft()
    if (draft) {
      dispatch({ type: 'replace', spec: draft })
      setFormKey(k => k + 1) // oxlint-disable-line react/set-state-in-effect -- one-time draft hand-off
    }
  }, [])

  const errors = validateSpec(spec)
  const invalid = Object.keys(errors).length > 0
  const compiled = useCompile(spec)
  const caption = dataOf(compiled.state)?.caption

  // Same client_job_id for retries of the same spec, so a retry after a lost response is idempotent.
  const submission = useRef<{ spec: BuilderSpec; id: string } | null>(null)
  const generate = useMutation((body: BuilderSpec & { client_job_id: string }) => api.createJob(body))
  const submitting = generate.state.status === 'loading'
  const onGenerate = async () => {
    if (invalid || submitting) return
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
          <span className="label">Create</span>
          <h1>Build a <em>song</em></h1>
        </div>
      </div>
      <div className="create">
        <div className="stack create__builder">
          <PresetPanel spec={spec} onLoad={load} />
          <AsyncView state={catalog} onRetry={reloadCatalog} label="builder options">
            {c => {
              const props = { spec, dispatch, catalog: c, errors }
              return (
                <div className="stack" key={formKey}>
                  <StylePanel {...props} />
                  <VocalsPanel {...props} />
                  <InstrumentsPanel {...props} />
                  <AmbiencePanel {...props} />
                  <AvoidPanel {...props} />
                  <MusicPanel {...props} />
                  <LyricsPanel {...props} />
                  <LengthPanel {...props} />
                  <AdvancedPanel {...props} />
                </div>
              )
            }}
          </AsyncView>
        </div>

        <aside className="create__rail card stack" aria-label="Preview and generate">
          <div className="stack rail__summary">
            <h2>{spec.title.trim() || 'Untitled song'}</h2>
            <span className="label">{formatDuration(spec.length.total_seconds)} · {spec.vocals.type === 'none' ? 'instrumental' : `${spec.vocals.type} vocal`}</span>
          </div>
          <CompilePreview spec={spec} dispatch={dispatch} compiled={compiled} />
          <div className="stack rail__go">
            {/* Phone only: the preview is far below, so the sticky bar carries a one-line caption. */}
            <p className="rail__status mono" data-testid="go-status" aria-hidden>
              {invalid ? 'Preview paused' : compiled.state.status === 'loading' ? 'Updating preview…'
                : compiled.state.status === 'error' ? 'Preview unavailable' : caption || 'Empty caption'}
            </p>
            <button type="button" className="btn btn--brand btn--block" onClick={onGenerate} disabled={invalid || submitting}>
              {submitting ? <Loader2 size={16} className="spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
              {submitting ? 'Sending…' : genError ? 'Try again' : 'Generate'}
            </button>
            {invalid && <p className="field__error">Fix the highlighted fields first.</p>}
            {genError && (
              <p className="field__error" role="alert">
                {genError.kind === 'unreachable'
                  ? "Can't reach your Mac, so the song isn't queued yet. Your settings are kept here; trying again won't create a duplicate."
                  : genError.message}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
