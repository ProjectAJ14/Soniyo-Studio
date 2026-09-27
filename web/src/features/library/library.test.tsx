import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { Song } from '../../api/types'
import { emptySpec } from '../../api/types'
import { LibraryScreen } from './LibraryScreen'

const api = vi.hoisted(() => ({ listSongs: vi.fn(), listPresets: vi.fn(), patchSong: vi.fn() }))
vi.mock('../../api/client', async orig => ({ ...(await orig<typeof import('../../api/client')>()), api }))
const play = vi.fn()
vi.mock('../player/PlayerProvider', () => ({ usePlayer: () => ({ play }) }))

const song: Song = {
  id: 's1', job_id: 'j1', title: 'Om Namah Shivaya', created_at: '2026-09-27T10:00:00Z', duration_seconds: 185,
  favourite: false, preset_id: 'p1', spec: emptySpec(), seed: 42, engine_info: {}, size_bytes: 1000,
  compiled: { caption: '', lyrics: '', negative_prompt: '', params: {} as never, plan: {} as never, routing: [], notes: [] },
}
const storage = { used_bytes: 5 * 1024 * 1024, free_bytes: 20 * 1024 ** 3 }

beforeEach(() => {
  api.listPresets.mockResolvedValue({ items: [{ id: 'p1', name: 'Shiva mantra' }] })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('library', () => {
  it('shows the empty state with a link to Create', async () => {
    api.listSongs.mockResolvedValue({ items: [], storage })
    render(<LibraryScreen />)
    expect(await screen.findByText('No songs yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create a song' })).toHaveAttribute('href', '#/create')
  })

  it('shows the error state and recovers on retry', async () => {
    api.listSongs.mockRejectedValueOnce(new ApiError('api', 'internal', 'Boom', true, 500))
    api.listSongs.mockResolvedValueOnce({ items: [song], storage })
    render(<LibraryScreen />)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByText('Om Namah Shivaya')).toBeInTheDocument()
  })

  it('renders loaded rows with storage, preset and play', async () => {
    api.listSongs.mockResolvedValue({ items: [song], storage })
    render(<LibraryScreen />)
    expect(await screen.findByRole('link', { name: 'Om Namah Shivaya' })).toHaveAttribute('href', '#/songs/s1')
    expect(screen.getByText('3:05')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB used · 20 GB free')).toBeInTheDocument()
    expect(await screen.findByText('Shiva mantra')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Play Om Namah Shivaya' }))
    expect(play).toHaveBeenCalledWith(song)
  })

  it('favourite is optimistic and rolls back on error', async () => {
    api.listSongs.mockResolvedValue({ items: [song], storage })
    let reject!: (e: unknown) => void
    api.patchSong.mockReturnValueOnce(new Promise((_, r) => { reject = r }))
    render(<LibraryScreen />)
    const fav = await screen.findByRole('button', { name: 'Favourite Om Namah Shivaya' })
    expect(fav).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(fav)
    expect(fav).toHaveAttribute('aria-pressed', 'true')
    expect(api.patchSong).toHaveBeenCalledWith('s1', { favourite: true })
    await act(async () => reject(new ApiError('unreachable', 'unreachable', 'Offline', true)))
    expect(fav).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent('Offline')
  })

  it('passes the favourites filter to the API', async () => {
    api.listSongs.mockResolvedValue({ items: [], storage })
    render(<LibraryScreen />)
    await screen.findByText('No songs yet')
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
    expect(await screen.findByText('No matching songs')).toBeInTheDocument()
    expect(api.listSongs).toHaveBeenLastCalledWith({ q: '', favourite: true, limit: 100 })
  })
})
