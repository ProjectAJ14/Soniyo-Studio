import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../api/client'
import { emptySpec, type Catalog, type CompileResult, type Job, type Preset } from '../../api/types'

vi.mock('../../api/client', async orig => {
  const mod = await orig<typeof import('../../api/client')>()
  return {
    ...mod,
    api: { catalog: vi.fn(), compile: vi.fn(), createJob: vi.fn(), listPresets: vi.fn(), createPreset: vi.fn() },
  }
})

const connection = vi.hoisted(() => ({ status: 'online' }))
vi.mock('../server/connection', () => ({ useConnection: () => connection }))

const { api } = await import('../../api/client')
const { CreateScreen } = await import('./CreateScreen')

const catalog: Catalog = {
  instruments: [{ name: 'tanpura', default_role: 'drone', tags: ['indian'] }],
  roles: ['drone', 'lead', 'supporting', 'background', 'accent'],
  levels: ['very soft', 'soft', 'present', 'prominent'],
  frequencies: ['rare', 'occasional', 'regular'],
  vocal_types: ['female', 'male', 'none'],
  vocal_characters: ['soft', 'warm'],
  vocal_deliveries: ['chant', 'sing', 'hum'],
  languages: [{ code: 'sa', name: 'Sanskrit' }],
  moods: ['calm'], deities: ['Shiva'], forms: ['bhajan'], avoid_chips: ['EDM'],
  reverbs: ['dry', 'light', 'medium', 'deep'], spaces: ['intimate', 'room', 'hall', 'spacious'],
  dynamics: ['steady', 'gentle swells', 'building'], keys: ['C major'], time_signatures: ['3', '4'],
  lm_cap_seconds: 480,
}

const compiled = (caption: string): CompileResult => ({
  caption, lyrics: '', negative_prompt: 'EDM',
  params: {
    prompt: caption, lyrics: '', lm_negative_prompt: 'EDM', bpm: null, key_scale: '', time_signature: '4',
    audio_duration: 180, vocal_language: '', thinking: false, use_cot_caption: false, seed: -1,
    lm_temperature: 0.85, batch_size: 1, inference_steps: 8, audio_format: 'flac',
  },
  plan: { lm_text_pass: false, lm_off_render: false, lm_cap_seconds: 480 },
  routing: [{ item: 'EDM', target: 'lm_negative_prompt' }], notes: [],
})

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.mocked(api.catalog).mockResolvedValue(catalog)
  vi.mocked(api.listPresets).mockResolvedValue({ items: [] })
  vi.mocked(api.compile).mockResolvedValue(compiled('calm female vocal'))
  location.hash = '#/create'
})
afterEach(() => { cleanup(); vi.clearAllMocks(); connection.status = 'online' })

describe('CreateScreen', () => {
  it('compile preview renders loading, then success, then error', async () => {
    const first = deferred<CompileResult>()
    vi.mocked(api.compile).mockReturnValueOnce(first.promise)
    render(<CreateScreen />)
    expect(await screen.findByText('Loading compile preview')).toBeInTheDocument()
    await act(async () => first.resolve(compiled('serene drone')))
    expect(await screen.findByTestId('caption')).toHaveTextContent('serene drone')
    expect(screen.getByText('EDM → negative prompt')).toBeInTheDocument()

    vi.mocked(api.compile).mockRejectedValueOnce(new ApiError('api', 'internal', 'Compiler exploded', true, 500))
    await userEvent.type(await screen.findByLabelText('Title'), 'x')
    expect(await screen.findByText('Compiler exploded', {}, { timeout: 2000 })).toBeInTheDocument()
  })

  it('while the Mac is unreachable Generate is held back but the builder still works', async () => {
    connection.status = 'unreachable'
    render(<CreateScreen />)
    const btn = await screen.findByRole('button', { name: 'Generate' })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/Your Mac is unreachable. Keep editing/)).toBeInTheDocument()
    await userEvent.type(await screen.findByLabelText('Title'), 'Om')
    expect(screen.getByLabelText('Title')).toHaveValue('Om')
    await userEvent.click(btn)
    expect(api.createJob).not.toHaveBeenCalled()
  })

  it('the Generate bar carries a one-line caption status', async () => {
    render(<CreateScreen />)
    await screen.findByTestId('caption')
    expect(screen.getByTestId('go-status')).toHaveTextContent('calm female vocal')
  })

  it('Generate sends a client_job_id, disables while submitting, reuses the id on retry', async () => {
    const u = userEvent.setup()
    vi.mocked(api.createJob).mockRejectedValueOnce(new ApiError('unreachable', 'unreachable', 'down', true))
    render(<CreateScreen />)
    const btn = await screen.findByRole('button', { name: 'Generate' })
    await u.click(btn)
    expect(await screen.findByText(/isn't queued yet/)).toBeInTheDocument()
    const firstId = vi.mocked(api.createJob).mock.calls[0][0].client_job_id
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/)

    const pending = deferred<Job>()
    vi.mocked(api.createJob).mockReturnValueOnce(pending.promise)
    await u.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled()
    expect(vi.mocked(api.createJob).mock.calls[1][0].client_job_id).toBe(firstId)
    await act(async () => pending.resolve({ id: 'j1' } as Job))
    await waitFor(() => expect(location.hash).toBe('#/queue'))
  })

  it('vocal type None collapses the vocal controls', async () => {
    render(<CreateScreen />)
    expect(await screen.findByRole('group', { name: 'Delivery' })).toBeInTheDocument()
    const types = screen.getByRole('group', { name: 'Vocal type' })
    expect(types.querySelector('button')).toHaveTextContent('None')
    await userEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(screen.queryByRole('group', { name: 'Delivery' })).toBeNull()
    expect(screen.queryByLabelText('Language')).toBeNull()
    expect(screen.getByText(/Instrumental/)).toBeInTheDocument()
  })

  it('starts on Quick start when presets exist; picking one loads it and keeps your title', async () => {
    const preset = { id: 'p1', name: 'Shiva drone', builtin: true, created_at: '', updated_at: '',
      spec: { ...emptySpec(), title: 'Preset title', style: 'slow drone', length: { mode: 'single' as const, total_seconds: 300 } } }
    vi.mocked(api.listPresets).mockResolvedValue({ items: [preset] })
    render(<CreateScreen />)
    await userEvent.type(await screen.findByLabelText('Title'), 'Mine')
    await userEvent.click(await screen.findByRole('button', { name: /Shiva drone/ }))
    expect(screen.getByRole('button', { name: /Shiva drone/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Title')).toHaveValue('Mine')
    expect(screen.queryByLabelText('BPM')).toBeNull() // quick start hides the detail panels
    await userEvent.click(screen.getByRole('button', { name: /Customize/ }))
    expect(screen.getByLabelText('Style')).toHaveValue('slow drone')
  })

  it('blocks Generate on an out-of-range BPM', async () => {
    render(<CreateScreen />)
    await userEvent.type(await screen.findByLabelText('BPM'), '400')
    expect(screen.getAllByText(/BPM must be/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  })

  it('copies a configuration prompt and turns a pasted LLM reply into a loaded preset', async () => {
    const u = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<CreateScreen />)
    await u.type(await screen.findByLabelText(/Describe the song/), 'Shiva night chant')
    await u.click(screen.getByRole('button', { name: 'Copy configuration prompt' }))
    const prompt = writeText.mock.calls[0][0]
    expect(prompt).toContain('tanpura: drone')
    expect(prompt).toContain('Shiva night chant')
    expect(await screen.findByText(/Prompt copied/)).toBeInTheDocument()

    const spec = { ...emptySpec(), title: 'Night chant' }
    vi.mocked(api.createPreset).mockResolvedValue({ id: 'p1', name: 'Night chant', builtin: false, spec } as Preset)
    const reply = 'Sure!\n```json\n{"title": "Night chant", "client_job_id": "x", "moods": ["calm"]}\n```'
    await u.click(screen.getByLabelText('Paste the JSON reply'))
    await u.paste(reply)
    await u.click(screen.getByRole('button', { name: 'Create preset' }))
    expect(api.createPreset).toHaveBeenCalledWith('Night chant', { title: 'Night chant', moods: ['calm'] })
    expect(await screen.findByText(/saved and loaded/)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Night chant')
    await waitFor(() => expect(api.listPresets).toHaveBeenCalledTimes(2))
  })

  it('shows why a pasted reply is not JSON', async () => {
    const u = userEvent.setup()
    render(<CreateScreen />)
    await u.click(await screen.findByLabelText('Paste the JSON reply'))
    await u.paste('I cannot help with that')
    await u.click(screen.getByRole('button', { name: 'Create preset' }))
    expect(await screen.findByText(/No JSON object found/)).toBeInTheDocument()
    expect(api.createPreset).not.toHaveBeenCalled()
  })
})
