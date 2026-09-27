// The only module that talks to the network. Everything else calls these functions.
import type {
  BuilderSpec, Catalog, CompileResult, Health, Job, JobState, Preset, Song, SongList,
} from './types'
import { getPairing } from '../lib/pairing'

export type ApiErrorKind = 'unpaired' | 'unreachable' | 'unauthorized' | 'api'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code: string
  readonly retryable: boolean
  readonly status: number | null

  constructor(kind: ApiErrorKind, code: string, message: string, retryable: boolean, status: number | null = null) {
    super(message)
    this.kind = kind
    this.code = code
    this.retryable = retryable
    this.status = status
  }
}

const TIMEOUT_MS = 15_000

/** Tailscale Serve answers 502/503/504 with no JSON envelope when the gateway behind it is down.
 * That is "Mac unreachable", not an API error (the gateway's own 503 carries an envelope). */
export function isProxyDown(status: number, data: unknown): boolean {
  return (status === 502 || status === 503 || status === 504) && !(data as { error?: unknown } | null)?.error
}
export const PROXY_DOWN_MESSAGE = "Your Mac's gateway isn't answering (it may be restarting). Wait a moment, then retry."

function base(): { url: string; token: string } {
  const p = getPairing()
  if (!p) throw new ApiError('unpaired', 'unpaired', 'Pair this device with your Mac first.', false)
  return { url: p.baseUrl.replace(/\/+$/, '') + '/api/v1', token: p.token }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, token } = base()
  let res: Response
  try {
    res = await fetch(url + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new ApiError('unreachable', 'unreachable',
      "Can't reach your Mac. Check that the Tailscale app is connected, then retry.", true)
  }
  if (res.status === 204) return undefined as T
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    if (isProxyDown(res.status, data)) throw new ApiError('unreachable', 'unreachable', PROXY_DOWN_MESSAGE, true, res.status)
    const err = (data as { error?: { code: string; message: string; retryable: boolean } } | null)?.error
    const kind: ApiErrorKind = res.status === 401 ? 'unauthorized' : 'api'
    throw new ApiError(kind, err?.code ?? 'internal', err?.message ?? `Gateway returned ${res.status}.`,
      err?.retryable ?? res.status >= 500, res.status)
  }
  return data as T
}

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const api = {
  health: () => request<Health>('GET', '/health'),
  catalog: () => request<Catalog>('GET', '/catalog'),
  compile: (spec: BuilderSpec) => request<CompileResult>('POST', '/compile', spec),

  createJob: (spec: BuilderSpec & { client_job_id: string }) => request<Job>('POST', '/jobs', spec),
  listJobs: (states?: JobState[], limit = 50) =>
    request<{ items: Job[] }>('GET', '/jobs' + q({ state: states?.join(','), limit })),
  getJob: (id: string) => request<Job>('GET', `/jobs/${id}`),
  cancelJob: (id: string) => request<Job>('POST', `/jobs/${id}/cancel`),
  retryJob: (id: string) => request<Job>('POST', `/jobs/${id}/retry`),

  listSongs: (opts: { q?: string; favourite?: boolean; limit?: number } = {}) =>
    request<SongList>('GET', '/songs' + q(opts)),
  getSong: (id: string) => request<Song>('GET', `/songs/${id}`),
  patchSong: (id: string, patch: { title?: string; favourite?: boolean }) =>
    request<Song>('PATCH', `/songs/${id}`, patch),
  deleteSong: (id: string) => request<void>('DELETE', `/songs/${id}`),
  regenerateSong: (id: string, seed: 'same' | 'new') =>
    request<Job>('POST', `/songs/${id}/regenerate`, { seed }),

  listPresets: () => request<{ items: Preset[] }>('GET', '/presets'),
  createPreset: (name: string, spec: BuilderSpec) => request<Preset>('POST', '/presets', { name, spec }),
  updatePreset: (id: string, name: string, spec: BuilderSpec) =>
    request<Preset>('PUT', `/presets/${id}`, { name, spec }),
  deletePreset: (id: string) => request<void>('DELETE', `/presets/${id}`),

  /** URLs for elements that cannot send headers (<audio>, <a download>, EventSource). */
  audioUrl: (id: string, format: 'mp3' | 'flac' = 'mp3', download = false) => {
    const { url, token } = base()
    return `${url}/songs/${id}/audio` + q({ format, download: download ? 1 : undefined, token })
  },
  jobEventsUrl: (id: string) => {
    const { url, token } = base()
    return `${url}/jobs/${id}/events` + q({ token })
  },
}
