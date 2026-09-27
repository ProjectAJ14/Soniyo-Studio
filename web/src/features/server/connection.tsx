// Polls /health so the whole app knows whether the Mac is online, unreachable or rejecting us.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, KeyRound, RotateCw, WifiOff } from 'lucide-react'
import { api, onConnectivity } from '../../api/client'
import type { Health } from '../../api/types'
import { notifyReconnected, toApiError } from '../../lib/async'
import { forgetPairing } from './pairing'

export type ConnectionStatus = 'checking' | 'online' | 'unreachable' | 'unauthorized' | 'error'

export interface Connection {
  status: ConnectionStatus
  /** Gateway error code when status is 'error' (it answered, but with a failure). */
  errorCode: string | null
  health: Health | null
  lastChecked: Date | null
  retry: () => void
}

const POLL_MS = 15_000
const Ctx = createContext<Connection | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Connection, 'retry'>>({ status: 'checking', errorCode: null, health: null, lastChecked: null })
  const run = useRef(0)
  const wasDown = useRef(false)
  const busy = useRef(false)

  const check = useCallback(async () => {
    const id = ++run.current
    busy.current = true
    let status: ConnectionStatus
    let health: Health | null = null
    let errorCode: string | null = null
    try {
      health = await api.health()
      // A bad token still gets the reduced public /health; /catalog tells us whether we're authorised.
      if (!health.engine && !health.disk) await api.catalog()
      status = 'online'
    } catch (e) {
      // client.ts already classifies a proxy 5xx (gateway down behind Tailscale) as unreachable.
      const err = toApiError(e)
      status = err.kind === 'unauthorized' ? 'unauthorized' : err.kind === 'api' ? 'error' : 'unreachable'
      if (status === 'error') errorCode = err.code
    }
    if (id !== run.current) return
    busy.current = false
    if (status === 'online' && wasDown.current) notifyReconnected()
    wasDown.current = status === 'unreachable'
    setState(s => ({ status, errorCode, health: health ?? s.health, lastChecked: new Date() }))
  }, [])

  const retry = useCallback(() => {
    setState(s => ({ ...s, status: 'checking' }))
    void check()
  }, [check])

  // Any api call that fails to reach the Mac shows the banner now; the first one that gets
  // through while down re-checks, so recovery (and notifyReconnected) is immediate too.
  // Reports from check()'s own requests are ignored while it runs.
  useEffect(() => onConnectivity(reachable => {
    if (busy.current || reachable !== wasDown.current) return
    if (reachable) { void check(); return }
    wasDown.current = true
    setState(s => ({ ...s, status: 'unreachable', errorCode: null, lastChecked: new Date() }))
  }), [check])

  useEffect(() => {
    void check()
    const onWake = () => { void check() }
    const timer = setInterval(onWake, POLL_MS)
    addEventListener('focus', onWake)
    addEventListener('online', onWake)
    return () => {
      clearInterval(timer)
      removeEventListener('focus', onWake)
      removeEventListener('online', onWake)
    }
  }, [check])

  return <Ctx.Provider value={{ ...state, retry }}>{children}</Ctx.Provider>
}

// oxlint-disable-next-line react/only-export-components -- provider and its hook belong together
export function useConnection(): Connection {
  const c = useContext(Ctx)
  if (!c) throw new Error('useConnection must be used inside <ConnectionProvider>')
  return c
}

export function ConnectionBanner() {
  const { status, errorCode, retry } = useConnection()
  if (status === 'error') {
    return (
      <div className="banner" role="alert">
        <AlertTriangle size={16} aria-hidden />
        <span>Your Mac's gateway returned an error: {errorCode}</span>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={retry}>
          <RotateCw size={16} aria-hidden /> Retry
        </button>
      </div>
    )
  }
  if (status === 'unreachable') {
    return (
      <div className="banner" role="alert">
        <WifiOff size={16} aria-hidden />
        <span>Can't reach your Mac. Is the Tailscale app connected?</span>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={retry}>
          <RotateCw size={16} aria-hidden /> Retry
        </button>
      </div>
    )
  }
  if (status === 'unauthorized') {
    return (
      <div className="banner" role="alert">
        <KeyRound size={16} aria-hidden />
        <span>Your Mac rejected this device's token.</span>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={forgetPairing}>Re-pair</button>
      </div>
    )
  }
  return null
}
