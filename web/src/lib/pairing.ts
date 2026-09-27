// Gateway URL + owner token, stored on this device (F26). Storage can throw in private mode.
import { useSyncExternalStore } from 'react'

export interface Pairing { baseUrl: string; token: string }

const KEY = 'soniyo.pairing'
const listeners = new Set<() => void>()
let cached: Pairing | null | undefined

function read(): Pairing | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Pairing) : null
  } catch {
    return null
  }
}

export function getPairing(): Pairing | null {
  if (cached === undefined) cached = read()
  return cached
}

export function setPairing(p: Pairing | null): void {
  cached = p
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p))
    else localStorage.removeItem(KEY)
  } catch { /* in-memory pairing still works for this session */ }
  listeners.forEach(l => l())
}

const GATEWAY_PORT = '8787'
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Prefill for the pairing form. Only when the gateway itself serves this app (Tailscale Serve
 * on *.ts.net, or loopback on the gateway port) is its own origin the API; a Firebase or dev
 * origin is not, so fall back to VITE_API_BASE or leave it empty for the placeholder. */
export function defaultBaseUrl(loc: Pick<Location, 'hostname' | 'port' | 'origin'> = location): string {
  const host = loc.hostname.toLowerCase()
  if (host.endsWith('.ts.net') || (LOOPBACK.has(host) && loc.port === GATEWAY_PORT)) return loc.origin
  return import.meta.env.VITE_API_BASE ?? ''
}

export function usePairing(): Pairing | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    getPairing,
  )
}
