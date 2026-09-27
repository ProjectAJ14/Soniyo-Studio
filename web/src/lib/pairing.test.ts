import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultBaseUrl } from './pairing'

const at = (url: string) => { const u = new URL(url); return { hostname: u.hostname, port: u.port, origin: u.origin } }

afterEach(() => { vi.unstubAllEnvs() })

describe('defaultBaseUrl', () => {
  it('uses the origin when the gateway serves the app', () => {
    expect(defaultBaseUrl(at('https://mac.tail1234.ts.net'))).toBe('https://mac.tail1234.ts.net')
    expect(defaultBaseUrl(at('http://127.0.0.1:8787'))).toBe('http://127.0.0.1:8787')
    expect(defaultBaseUrl(at('http://localhost:8787'))).toBe('http://localhost:8787')
  })

  it('does not prefill a hosting or dev origin', () => {
    vi.stubEnv('VITE_API_BASE', undefined)
    expect(defaultBaseUrl(at('https://soniyo.web.app'))).toBe('')
    expect(defaultBaseUrl(at('http://localhost:5173'))).toBe('')
  })

  it('falls back to VITE_API_BASE off-gateway', () => {
    vi.stubEnv('VITE_API_BASE', 'https://mac.tail1234.ts.net')
    expect(defaultBaseUrl(at('https://soniyo.web.app'))).toBe('https://mac.tail1234.ts.net')
  })
})
