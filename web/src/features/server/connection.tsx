// Polls /health so the whole app knows whether the Mac is online, unreachable or rejecting us.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { KeyRound, RotateCw, WifiOff } from 'lucide-react'
import { api } from '../../api/client'
import type { Health } from '../../api/types'
import { toApiError } from '../../lib/async'
import { forgetPairing } from './pairing'

export type ConnectionStatus = 'checking' | 'online' | 'unreachable' | 'unauthorized'

export interface Connection {
  status: ConnectionStatus
  health: Health | null
  lastChecked: Date | null
  retry: () => void
}

const POLL_MS = 15_000
const Ctx = createContext<Connection | null>(null)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Connection, 'retry'>>({ status: 'checking', health: null, lastChecked: null })
  const run = useRef(0)

  const check = useCallback(async () => {
    const id = ++run.current
    let status: ConnectionStatus
    let health: Health | null = null
    try {
      health = await api.health()
      // A bad token still gets the reduced public /health; /catalog tells us whether we're authorised.
      if (!health.engine && !health.disk) await api.catalog()
      status = 'online'
    } catch (e) {
      // A gateway 5xx behind Tailscale Serve is as good as down from here.
      status = toApiError(e).kind === 'unauthorized' ? 'unauthorized' : 'unreachable'
    }
    if (id !== run.current) return
    setState(s => ({ status, health: health ?? s.health, lastChecked: new Date() }))
  }, [])

  const retry = useCallback(() => {
    setState(s => ({ ...s, status: 'checking' }))
    void check()
  }, [check])

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
  const { status, retry } = useConnection()
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
