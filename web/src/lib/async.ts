// Every remote value in the app is one of these four states. Render with <AsyncView>.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

export type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading'; previous?: T }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError; previous?: T }

export const idle = { status: 'idle' } as const

const RECONNECTED = 'soniyo:reconnected'
/** Called when the Mac answers again: every view stuck on an unreachable error refetches. */
export function notifyReconnected(): void { dispatchEvent(new Event(RECONNECTED)) }

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError('api', 'internal', e instanceof Error ? e.message : 'Something went wrong.', true)
}

/** Latest known data regardless of state — lets a refresh keep showing old rows. */
export function dataOf<T>(s: AsyncState<T>): T | undefined {
  if (s.status === 'success') return s.data
  if (s.status === 'loading' || s.status === 'error') return s.previous
  return undefined
}

/**
 * Run `fn` on mount and whenever `deps` change; `reload()` re-runs it keeping the
 * previous data visible. Stale responses from superseded runs are dropped.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): [AsyncState<T>, () => void, (d: T) => void] {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const run = useRef(0)
  const fnRef = useRef(fn)
  useLayoutEffect(() => { fnRef.current = fn })

  const load = useCallback(() => {
    const id = ++run.current
    // oxlint-disable-next-line react/set-state-in-effect -- a fetch hook must enter loading
    setState(s => ({ status: 'loading', previous: dataOf(s) }))
    fnRef.current().then(
      data => { if (id === run.current) setState({ status: 'success', data }) },
      e => { if (id === run.current) setState(s => ({ status: 'error', error: toApiError(e), previous: dataOf(s) })) },
    )
  }, [])

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- caller owns deps, like useEffect
  useEffect(load, deps)
  const stateRef = useRef(state)
  useLayoutEffect(() => { stateRef.current = state })
  useEffect(() => {
    const onReconnect = () => {
      const s = stateRef.current
      if (s.status === 'error' && s.error.kind === 'unreachable') load()
    }
    addEventListener(RECONNECTED, onReconnect)
    return () => removeEventListener(RECONNECTED, onReconnect)
  }, [load])
  // Pushed data (SSE) is fresher than any load still in flight: invalidate those.
  const set = useCallback((data: T) => { ++run.current; setState({ status: 'success', data }) }, [])
  return [state, load, set]
}

/** For user-triggered mutations: idle until called, then loading → success | error. */
export function useMutation<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>(idle)
  const fnRef = useRef(fn)
  useLayoutEffect(() => { fnRef.current = fn })
  const mutate = useCallback(async (...args: A): Promise<T | undefined> => {
    setState({ status: 'loading' })
    try {
      const data = await fnRef.current(...args)
      setState({ status: 'success', data })
      return data
    } catch (e) {
      setState({ status: 'error', error: toApiError(e) })
      return undefined
    }
  }, [])
  const reset = useCallback(() => setState(idle), [])
  return { state, mutate, reset }
}
