// Pairing verification and forgetting (F26). Kept out of the component files for fast refresh.
import { ApiError } from '../../api/client'
import type { Health } from '../../api/types'
import { getPairing, setPairing, type Pairing } from '../../lib/pairing'

// Survives "Forget pairing" / "Re-pair" within the session so the URL stays prefilled.
let remembered: string | null = null
export const lastBaseUrl = () => remembered

export function forgetPairing(): void {
  remembered = getPairing()?.baseUrl ?? remembered
  setPairing(null)
}

/** Returns an error message, or null when the URL is usable. */
export function checkUrl(raw: string): string | null {
  let u: URL
  try { u = new URL(raw) } catch { return 'Enter a full URL, like https://my-mac.tailnet.ts.net' }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return 'Use the https:// address from Tailscale Serve.'
  return null
}

// The api client reads the stored pairing, so a candidate pairing is verified here with a
// one-off request before it is saved. Error kinds match client.ts.
async function get<T>(p: Pairing, path: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${p.baseUrl}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${p.token}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ApiError('unreachable', 'unreachable',
      `Can't reach ${p.baseUrl}. Check the address and that the Tailscale app is connected on this device.`, true)
  }
  if (res.status === 401) {
    throw new ApiError('unauthorized', 'unauthorized', 'Token rejected. Copy the owner token from the Mac again.', false, 401)
  }
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok || data === null) {
    throw new ApiError('api', 'not_gateway', `That address answered, but not like a Soniyo gateway (HTTP ${res.status}).`, true, res.status)
  }
  return data as T
}

export async function verifyPairing(p: Pairing): Promise<Pairing> {
  const health = await get<Health>(p, '/health')
  if (health.status !== 'ok') throw new ApiError('api', 'not_gateway', 'That address is not a Soniyo gateway.', false)
  await get(p, '/catalog') // bare /health ignores bad tokens; /catalog does not
  setPairing(p)
  return p
}
