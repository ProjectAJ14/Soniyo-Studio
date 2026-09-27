import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../api/client'
import { getPairing, setPairing } from '../../lib/pairing'

vi.mock('../../api/client', async orig => {
  const mod = await orig<typeof import('../../api/client')>()
  return { ...mod, api: { health: vi.fn(), catalog: vi.fn() } }
})

const { api } = await import('../../api/client')
const { PairingScreen } = await import('./PairingScreen')
const { checkUrl } = await import('./pairing')
const { ConnectionProvider, ConnectionBanner } = await import('./connection')

afterEach(cleanup)

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('PairingScreen', () => {
  beforeEach(() => setPairing(null))
  afterEach(() => vi.unstubAllGlobals())

  async function pair(url = 'https://mac.tail.ts.net') {
    const u = userEvent.setup()
    render(<PairingScreen />)
    const urlInput = screen.getByLabelText(/gateway url/i)
    await u.clear(urlInput)
    await u.type(urlInput, url)
    await u.type(screen.getByLabelText(/owner token/i), 'secret')
    await u.click(screen.getByRole('button', { name: /pair/i }))
  }

  it('shows "Token rejected" on 401 from /catalog and stores nothing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(200, { status: 'ok', version: '0.1.0' }))
      .mockResolvedValueOnce(json(401, { error: { code: 'unauthorized', message: 'x', retryable: false } })))
    await pair()
    expect(await screen.findByText('Token rejected')).toBeInTheDocument()
    expect(getPairing()).toBeNull()
  })

  it('shows unreachable when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    await pair()
    expect(await screen.findByText('Mac unreachable')).toBeInTheDocument()
  })

  it('stores the pairing once verified', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(200, { status: 'ok', version: '0.1.0' }))
      .mockResolvedValueOnce(json(200, { instruments: [] }))
    vi.stubGlobal('fetch', fetch)
    await pair('https://mac.tail.ts.net/')
    await waitFor(() => expect(getPairing()).toEqual({ baseUrl: 'https://mac.tail.ts.net', token: 'secret' }))
    expect(fetch.mock.calls[1][0]).toBe('https://mac.tail.ts.net/api/v1/catalog')
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer secret')
  })

  it('rejects non-https URLs before any request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await pair('http://mac.tail.ts.net')
    expect(screen.getByText(/https:\/\/ address/)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(checkUrl('http://localhost:8787')).toBeNull()
  })
})

describe('ConnectionBanner', () => {
  it('shows the Tailscale banner when unreachable and recovers on retry', async () => {
    vi.mocked(api.health)
      .mockRejectedValueOnce(new ApiError('unreachable', 'unreachable', 'down', true))
      .mockResolvedValue({ status: 'ok', version: '1', engine: null, disk: { free_bytes: 1, total_bytes: 2, used_by_library_bytes: 0, low: false } })
    render(<ConnectionProvider><ConnectionBanner /></ConnectionProvider>)
    expect(await screen.findByText(/Is the Tailscale app connected/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('offers Re-pair when the token is rejected', async () => {
    vi.mocked(api.health).mockResolvedValue({ status: 'ok', version: '1' })
    vi.mocked(api.catalog).mockRejectedValue(new ApiError('unauthorized', 'unauthorized', 'no', false, 401))
    render(<ConnectionProvider><ConnectionBanner /></ConnectionProvider>)
    expect(await screen.findByRole('button', { name: 'Re-pair' })).toBeInTheDocument()
  })
})
