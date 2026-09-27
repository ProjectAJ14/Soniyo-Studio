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

/** Same-origin default: when the gateway serves this app, its own origin is the API. */
export function defaultBaseUrl(): string {
  return import.meta.env.VITE_API_BASE ?? (location.protocol === 'https:' ? location.origin : '')
}

export function usePairing(): Pairing | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    getPairing,
  )
}
