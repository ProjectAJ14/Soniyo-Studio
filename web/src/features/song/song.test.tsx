import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { Song } from '../../api/types'
import { emptySpec } from '../../api/types'
import { takeDraft } from '../../lib/draft'
import { SongScreen } from './SongScreen'

const api = vi.hoisted(() => ({
  getSong: vi.fn(), patchSong: vi.fn(), deleteSong: vi.fn(), regenerateSong: vi.fn(), audioBlob: vi.fn(),
  audioUrl: (id: string, fmt = 'mp3', dl = false) => `http://mac/api/v1/songs/${id}/audio?format=${fmt}${dl ? '&download=1' : ''}`,
}))
vi.mock('../../api/client', async orig => ({ ...(await orig<typeof import('../../api/client')>()), api }))
const player = vi.hoisted(() => ({ play: vi.fn(), updateSong: vi.fn() }))
vi.mock('../player/PlayerProvider', () => ({ usePlayer: () => player }))

const song: Song = {
  id: 's1', job_id: 'j1', title: 'Om Namah Shivaya', created_at: '2026-09-27T10:00:00Z', duration_seconds: 185,
  favourite: false, preset_id: null, seed: 42, engine_info: { model: 'acestep-v15' }, size_bytes: 1000,
  spec: { ...emptySpec(), title: 'Om Namah Shivaya', lyrics: { text: 'Om\nNamah', repeat: null },
    instruments: [{ name: 'tanpura', role: 'drone', level: 'soft', frequency: null }] },
  compiled: { caption: 'peaceful mantra', lyrics: '', negative_prompt: 'drums', params: {} as never, plan: {} as never, routing: [], notes: [] },
}

beforeEach(() => { location.hash = '#/songs/s1' })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('song', () => {
  it('shows not found with a link back on 404', async () => {
    api.getSong.mockRejectedValue(new ApiError('api', 'not_found', 'Song not found.', false, 404))
    render(<SongScreen id="nope" />)
    expect(await screen.findByText('Song not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to library/ })).toHaveAttribute('href', '#/library')
  })

  it('renders details and download links', async () => {
    api.getSong.mockResolvedValue(song)
    render(<SongScreen id="s1" />)
    expect(await screen.findByRole('heading', { name: 'Om Namah Shivaya' })).toBeInTheDocument()
    expect(screen.getByText('peaceful mantra')).toBeInTheDocument()
    expect(screen.getByText('tanpura')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download FLAC' })).toHaveAttribute('href', expect.stringContaining('format=flac&download=1'))
    expect(screen.getByRole('link', { name: 'Download MP3' })).toHaveAttribute('download')
  })

  it('shares the MP3 file itself, not the app URL', async () => {
    api.getSong.mockResolvedValue(song)
    api.audioBlob.mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }))
    const share = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { canShare: () => true, share })
    try {
      render(<SongScreen id="s1" />)
      fireEvent.click(await screen.findByRole('button', { name: /Share/ }))
      await vi.waitFor(() => expect(share).toHaveBeenCalled())
      const { files, title } = share.mock.calls[0][0] as { files: File[]; title: string }
      expect(title).toBe('Om Namah Shivaya')
      expect(files[0].name).toBe('Om Namah Shivaya.mp3')
      expect(files[0].type).toBe('audio/mpeg')
      expect(api.audioBlob).toHaveBeenCalledWith('s1')
    } finally {
      Object.assign(navigator, { canShare: undefined, share: undefined })
    }
  })

  it('delete needs an inline confirm, then navigates to the library', async () => {
    api.getSong.mockResolvedValue(song)
    api.deleteSong.mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<SongScreen id="s1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(api.deleteSong).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByText('Delete this song and its audio files?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })) })
    expect(api.deleteSong).toHaveBeenCalledWith('s1')
    expect(location.hash).toBe('#/library')
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('shows a delete error inline and stays on the page', async () => {
    api.getSong.mockResolvedValue(song)
    api.deleteSong.mockRejectedValue(new ApiError('api', 'internal', 'Disk busy', true, 500))
    render(<SongScreen id="s1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Disk busy')
    expect(location.hash).toBe('#/songs/s1')
  })

  it('rename rejects an empty title without calling the API', async () => {
    api.getSong.mockResolvedValue(song)
    render(<SongScreen id="s1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Title cannot be empty.')
    expect(api.patchSong).not.toHaveBeenCalled()
  })

  it('a successful rename updates the player bar title', async () => {
    api.getSong.mockResolvedValue(song)
    api.patchSong.mockResolvedValue({ ...song, title: 'Shiva dhyanam' })
    render(<SongScreen id="s1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Shiva dhyanam' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(api.patchSong).toHaveBeenCalledWith('s1', { title: 'Shiva dhyanam' })
    expect(player.updateSong).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', title: 'Shiva dhyanam' }))
    expect(screen.getByRole('heading', { name: 'Shiva dhyanam' })).toBeInTheDocument()
  })

  it('edit and regenerate hands the spec to Create', async () => {
    api.getSong.mockResolvedValue(song)
    render(<SongScreen id="s1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit and regenerate' }))
    expect(takeDraft()?.title).toBe('Om Namah Shivaya')
    expect(location.hash).toBe('#/create')
  })
})
