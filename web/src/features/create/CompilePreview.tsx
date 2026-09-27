// F9: live caption preview. Compiles the spec 400 ms after the last edit; expert mode edits the caption.
import { useEffect, useState, type Dispatch } from 'react'
import { ApiError, api } from '../../api/client'
import type { BuilderSpec, CompileResult } from '../../api/types'
import { AsyncView } from '../../components/AsyncView'
import { dataOf, useAsync } from '../../lib/async'
import { formatDuration } from '../../lib/format'
import { validateSpec, type SpecAction } from './specReducer'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function Result({ r }: { r: CompileResult }) {
  const p = r.params
  const params: [string, string][] = [
    ['BPM', p.bpm === null ? 'auto' : String(p.bpm)],
    ['Key', p.key_scale || 'auto'],
    ['Time', p.time_signature ? `${p.time_signature}/4` : 'auto'],
    ['Length', formatDuration(p.audio_duration)],
    ['Language', p.vocal_language || 'auto'],
    ['Seed', p.seed < 0 ? 'random' : String(p.seed)],
    ['LM temp', String(p.lm_temperature)],
    ['Steps', String(p.inference_steps)],
  ]
  return (
    <div className="stack preview">
      <div className="field">
        <span className="label">Caption</span>
        <div className="code" data-testid="caption">{r.caption || '(empty)'}</div>
      </div>
      {r.negative_prompt && (
        <div className="field">
          <span className="label">Negative prompt</span>
          <div className="code">{r.negative_prompt}</div>
        </div>
      )}
      <dl className="params">
        {params.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="mono">{v}</dd></div>)}
      </dl>
      {(r.plan.lm_text_pass || r.plan.lm_off_render) && (
        <div className="row">
          {r.plan.lm_text_pass && <span className="badge badge--spot">LM text pass</span>}
          {r.plan.lm_off_render && <span className="badge badge--warn">LM off render</span>}
        </div>
      )}
      {r.routing.length > 0 && (
        <div className="field">
          <span className="label">Routing</span>
          <ul className="plain">
            {r.routing.map(x => (
              <li key={x.item} className="mono">{x.item} → {x.target === 'lm_negative_prompt' ? 'negative prompt' : 'caption'}</li>
            ))}
          </ul>
        </div>
      )}
      {r.notes.length > 0 && <ul className="plain notes">{r.notes.map(n => <li key={n} className="note">{n}</li>)}</ul>}
    </div>
  )
}

export function CompilePreview({ spec, dispatch }: { spec: BuilderSpec; dispatch: Dispatch<SpecAction> }) {
  const debounced = useDebounced(spec, 400)
  const invalid = Object.values(validateSpec(debounced))
  const [state, reload] = useAsync(() => invalid.length
    ? Promise.reject(new ApiError('api', 'validation_failed', invalid.join(' '), false)) // never sent
    : api.compile(debounced), [debounced])
  const override = spec.engine.caption_override
  const expert = override !== null
  const setOverride = (caption_override: string | null) => dispatch({ type: 'patch', section: 'engine', patch: { caption_override } })

  return (
    <div className="stack">
      <div className="row">
        <span className="label">Preview</span>
        {state.status === 'loading' && dataOf(state) && <span className="label" role="status">Updating…</span>}
        <span className="spacer" />
        <button type="button" className="chip" aria-pressed={expert}
          onClick={() => setOverride(expert ? null : dataOf(state)?.caption ?? '')}>
          Edit caption
        </button>
      </div>
      {expert && (
        <label className="field">
          <span className="label">Your caption (sent verbatim)</span>
          <textarea className="textarea" value={override} onChange={e => setOverride(e.target.value)} />
        </label>
      )}
      {invalid.length ? (
        <p className="field__error" role="alert">Fix these to see the preview: {invalid.join(' ')}</p>
      ) : (
        <AsyncView state={state} onRetry={reload} label="compile preview">
          {r => <Result r={r} />}
        </AsyncView>
      )}
    </div>
  )
}
