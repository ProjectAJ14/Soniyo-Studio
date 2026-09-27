import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw, WifiOff } from 'lucide-react'
import type { ApiError } from '../api/client'
import type { AsyncState } from '../lib/async'
import { dataOf } from '../lib/async'

interface Props<T> {
  state: AsyncState<T>
  children: (data: T) => ReactNode
  onRetry?: () => void
  /** Shown instead of children when `isEmpty(data)` — the fifth state lists need. */
  empty?: ReactNode
  isEmpty?: (data: T) => boolean
  loading?: ReactNode
  label?: string
}

/**
 * Renders every AsyncState explicitly: loading (skeleton, or previous data while
 * refreshing), error (with Retry), empty, loaded. Screens never hand-roll these.
 */
export function AsyncView<T>({ state, children, onRetry, empty, isEmpty, loading, label = 'content' }: Props<T>) {
  const data = dataOf(state)
  if (state.status === 'error' && data === undefined) {
    return <ErrorState error={state.error} onRetry={onRetry} />
  }
  if (data === undefined) {
    return <>{loading ?? <LoadingState label={label} />}</>
  }
  return (
    <>
      {state.status === 'error' && <ErrorState error={state.error} onRetry={onRetry} compact />}
      {isEmpty?.(data) && empty ? empty : children(data)}
    </>
  )
}

export function LoadingState({ label = 'content', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="state" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Loading {label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry, compact }: { error: ApiError; onRetry?: () => void; compact?: boolean }) {
  const unreachable = error.kind === 'unreachable'
  const Icon = unreachable ? WifiOff : AlertTriangle
  return (
    <div className="state state--error" role="alert" style={compact ? { marginBottom: 'var(--space-4)' } : undefined}>
      <div className="row">
        <Icon size={18} aria-hidden />
        <strong className="state__title">{unreachable ? 'Mac unreachable' : 'Something went wrong'}</strong>
        <span className="badge badge--error mono">{error.code}</span>
      </div>
      <p>{error.message}</p>
      {onRetry && (error.retryable || unreachable) && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          <RotateCw size={16} aria-hidden /> Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
