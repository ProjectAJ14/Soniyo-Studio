import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlayerBar } from './PlayerBar'
import { PlayerProvider, usePlayer } from './PlayerProvider'

vi.mock('../../api/client', () => ({
  api: { audioUrl: (id: string, fmt = 'mp3', dl = false) => `http://mac/api/v1/songs/${id}/audio?format=${fmt}${dl ? '&download=1' : ''}` },
}))

let playImpl: (this: HTMLMediaElement) => Promise<void>

beforeEach(() => {
  playImpl = function () { queueMicrotask(() => this.dispatchEvent(new Event('playing'))); return Promise.resolve() }
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { return playImpl.call(this) })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Harness() {
  const p = usePlayer()
  return (
    <>
      <span data-testid="state">{p.state}</span>
      <button onClick={() => p.play({ id: 's1', title: 'Om' })}>start</button>
      <PlayerBar />
    </>
  )
}

const state = () => screen.getByTestId('state').textContent

describe('player', () => {
  it('goes idle → loading → playing → paused → playing', async () => {
    render(<PlayerProvider><Harness /></PlayerProvider>)
    expect(state()).toBe('idle')
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()

    fireEvent.click(screen.getByText('start'))
    expect(state()).toBe('loading')
    await act(async () => {})
    expect(state()).toBe('playing')
    expect(screen.getByRole('link', { name: 'Om' })).toHaveAttribute('href', '#/songs/s1')
    expect(screen.getByRole('link', { name: 'Download MP3' })).toHaveAttribute('href', expect.stringContaining('download=1'))

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(state()).toBe('paused')

    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await act(async () => {})
    expect(state()).toBe('playing')
  })

  it('shows the error state when play() rejects, and loop toggles aria-pressed', async () => {
    playImpl = () => Promise.reject(new Error('Not allowed'))
    render(<PlayerProvider><Harness /></PlayerProvider>)
    fireEvent.click(screen.getByText('start'))
    await act(async () => {})
    expect(state()).toBe('error')
    expect(screen.getByRole('alert')).toHaveTextContent('Not allowed')

    const loop = screen.getByRole('button', { name: 'Loop' })
    expect(loop).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(loop)
    expect(loop).toHaveAttribute('aria-pressed', 'true')
  })
})
