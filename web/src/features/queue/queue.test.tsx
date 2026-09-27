import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api/client'
import type { Job } from '../../api/types'
import { emptySpec } from '../../api/types'
import { QueueScreen } from './QueueScreen'
import { groupJobs } from './useJobs'

const api = vi.hoisted(() => ({
  listJobs: vi.fn(),
  cancelJob: vi.fn(),
  retryJob: vi.fn(),
  jobEventsUrl: (id: string) => `http://mac/api/v1/jobs/${id}/events`,
  audioUrl: (id: string) => `http://mac/api/v1/songs/${id}/audio`,
}))
vi.mock('../../api/client', async orig => ({ ...(await orig<typeof import('../../api/client')>()), api }))
vi.mock('../player/PlayerProvider', () => ({ usePlayer: () => ({ play: vi.fn() }) }))

class FakeEventSource {
  static all: FakeEventSource[] = []
  url: string
  closed = false
  onerror: (() => void) | null = null
  listeners: ((e: MessageEvent) => void)[] = []
  constructor(url: string) { this.url = url; FakeEventSource.all.push(this) }
  addEventListener(_: string, fn: (e: MessageEvent) => void) { this.listeners.push(fn) }
  close() { this.closed = true }
  emit(job: Job) { this.listeners.forEach(l => l(new MessageEvent('job', { data: JSON.stringify(job) }))) }
}

const job = (over: Partial<Job>): Job => ({
  id: 'j', client_job_id: 'c', title: 'Song', state: 'queued', position: 1, spec: emptySpec(), compiled: null,
  created_at: '2026-09-27T10:00:00Z', started_at: null, finished_at: null, elapsed_seconds: null,
  estimate_seconds_left: null, timings: {}, error: null, song_id: null, ...over,
})

const running = job({ id: 'r', title: 'Running one', state: 'generating', position: 0, elapsed_seconds: 30, estimate_seconds_left: 90 })
const queued2 = job({ id: 'q2', title: 'Second', position: 2 })
const queued1 = job({ id: 'q1', title: 'First', position: 1 })
const done = job({ id: 'd', title: 'Done one', state: 'succeeded', position: null, song_id: 's1', finished_at: '2026-09-27T09:00:00Z' })
const failed = job({ id: 'f', title: 'Broke', state: 'failed', position: null, error: { code: 'engine_error', message: 'Engine crashed', retryable: true } })

beforeEach(() => {
  FakeEventSource.all = []
  vi.stubGlobal('EventSource', FakeEventSource)
  api.listJobs.mockResolvedValue({ items: [running, queued2, queued1, done, failed] })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('queue', () => {
  it('groups running, queued by position, and recent', () => {
    const g = groupJobs([running, queued2, queued1, done, failed])
    expect(g.running.map(j => j.id)).toEqual(['r'])
    expect(g.queued.map(j => j.id)).toEqual(['q1', 'q2'])
    expect(g.recent.map(j => j.id)).toEqual(['d', 'f'])
  })

  it('renders the stage stepper, song link and retry', async () => {
    render(<QueueScreen />)
    const card = await screen.findByRole('article', { name: 'Running: Running one' })
    expect(within(card).getByText('generating')).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('link', { name: 'Done one' })).toHaveAttribute('href', '#/songs/s1')
    expect(screen.getByText('Engine crashed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry Broke' })).toBeEnabled()
    expect(FakeEventSource.all.map(e => e.url).sort()).toEqual([
      'http://mac/api/v1/jobs/q1/events', 'http://mac/api/v1/jobs/q2/events', 'http://mac/api/v1/jobs/r/events',
    ])
  })

  it('cancel shows loading, then error inline, then succeeds', async () => {
    let reject!: (e: unknown) => void
    api.cancelJob.mockReturnValueOnce(new Promise((_, r) => { reject = r }))
    render(<QueueScreen />)
    const btn = await screen.findByRole('button', { name: 'Cancel First' })
    fireEvent.click(btn)
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Cancelling')
    await act(async () => reject(new ApiError('api', 'conflict', 'Job already started.', false, 409)))
    expect(screen.getByRole('alert')).toHaveTextContent('Job already started.')
    expect(btn).toBeEnabled()

    api.cancelJob.mockResolvedValueOnce({ ...queued1, state: 'cancelled', position: null })
    fireEvent.click(btn)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel First' })).toBeNull())
    expect(api.cancelJob).toHaveBeenLastCalledWith('q1')
  })

  it('falls back to polling every 5 s when SSE errors', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    render(<QueueScreen />)
    await screen.findByText('Running one')
    act(() => FakeEventSource.all[0].onerror?.())
    expect(await screen.findByText('Updating every 5 s')).toBeInTheDocument()
    expect(FakeEventSource.all.every(e => e.closed)).toBe(true)
    const calls = api.listJobs.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(5000) })
    expect(api.listJobs.mock.calls.length).toBe(calls + 1)
  })

  it('shows "Song ready" when a watched job succeeds over SSE', async () => {
    render(<QueueScreen />)
    await screen.findByText('Running one')
    const es = FakeEventSource.all.find(e => e.url.includes('/r/'))!
    act(() => es.emit({ ...running, state: 'succeeded', song_id: 's9' }))
    const notice = await screen.findByText('Song ready')
    expect(within(notice.parentElement!).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '#/songs/s9')
    expect(es.closed).toBe(true)
  })

  it('shows the error state with retry when the list fails', async () => {
    api.listJobs.mockRejectedValueOnce(new ApiError('unreachable', 'unreachable', "Can't reach your Mac.", true))
    render(<QueueScreen />)
    expect(await screen.findByText('Mac unreachable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByText('Running one')).toBeInTheDocument()
  })
})
