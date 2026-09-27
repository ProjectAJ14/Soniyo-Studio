// Owns the single <audio> element so playback survives navigation and iPad lock (F21).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { Song } from '../../api/types'

export type PlayerSong = Pick<Song, 'id' | 'title'>
export type PlayerState = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export interface Player {
  song: PlayerSong | null
  state: PlayerState
  position: number
  duration: number
  loop: boolean
  error: string | null
  play: (song: PlayerSong) => void
  toggle: () => void
  seek: (seconds: number) => void
  setLoop: (on: boolean) => void
  /** Unload and hide the bar, e.g. when the playing song is deleted. */
  stop: () => void
}

const PlayerContext = createContext<Player | null>(null)

// oxlint-disable-next-line react/only-export-components -- the hook belongs with its provider
export function usePlayer(): Player {
  const p = useContext(PlayerContext)
  if (!p) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return p
}

const mediaError = (a: HTMLAudioElement) =>
  a.error?.code === 4 ? 'This audio file could not be played.' : "Couldn't load audio from your Mac. Check the connection, then press play."

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [song, setSong] = useState<PlayerSong | null>(null)
  const [state, setState] = useState<PlayerState>('idle')
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loop, setLoopState] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fail = useCallback((message: string) => { setError(message); setState('error') }, [])

  const start = useCallback((a: HTMLAudioElement) => {
    setError(null)
    setState('loading')
    // play() rejects on autoplay policy or bad source; the 'error' event covers network failures too.
    a.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return // superseded by a newer play()
      fail(e instanceof Error ? e.message : 'Playback failed.')
    })
  }, [fail])

  const play = useCallback((next: PlayerSong) => {
    const a = audio.current
    if (!a) return
    setSong(next)
    setPosition(0)
    setDuration(0)
    try {
      a.src = api.audioUrl(next.id, 'mp3')
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Playback failed.')
      return
    }
    start(a)
  }, [start, fail])

  const toggle = useCallback(() => {
    const a = audio.current
    if (!a || !a.src) return
    if (state === 'playing' || state === 'loading') a.pause()
    else start(a)
  }, [state, start])

  const seek = useCallback((s: number) => {
    const a = audio.current
    if (a && Number.isFinite(s)) { a.currentTime = Math.max(0, s); setPosition(a.currentTime) }
  }, [])

  const setLoop = useCallback((on: boolean) => {
    if (audio.current) audio.current.loop = on
    setLoopState(on)
  }, [])

  const stop = useCallback(() => {
    const a = audio.current
    if (a) { a.pause(); a.removeAttribute('src'); a.load() }
    setSong(null)
    setState('idle')
  }, [])

  // Lock-screen / Control Center controls.
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (!ms || !song) return
    ms.metadata = typeof MediaMetadata === 'undefined' ? null : new MediaMetadata({ title: song.title, artist: 'Soniyo Studio' })
    const a = audio.current
    ms.setActionHandler('play', () => { if (a) start(a) })
    ms.setActionHandler('pause', () => a?.pause())
    ms.setActionHandler('seekto', d => { if (d.seekTime != null) seek(d.seekTime) })
    ms.setActionHandler('seekbackward', d => { if (a) seek(a.currentTime - (d.seekOffset ?? 10)) })
    ms.setActionHandler('seekforward', d => { if (a) seek(a.currentTime + (d.seekOffset ?? 10)) })
    return () => {
      for (const action of ['play', 'pause', 'seekto', 'seekbackward', 'seekforward'] as const) ms.setActionHandler(action, null)
    }
  }, [song, start, seek])

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
    if (ms) ms.playbackState = state === 'playing' ? 'playing' : state === 'paused' ? 'paused' : 'none'
  }, [state])

  const value = useMemo<Player>(
    () => ({ song, state, position, duration, loop, error, play, toggle, seek, setLoop, stop }),
    [song, state, position, duration, loop, error, play, toggle, seek, setLoop, stop],
  )

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audio}
        preload="metadata"
        hidden
        onPlaying={() => setState('playing')}
        onPause={e => { if (!e.currentTarget.error) setState(s => (s === 'error' ? s : 'paused')) }}
        onWaiting={() => setState('loading')}
        onEnded={() => setState('paused')}
        onError={e => { if (e.currentTarget.getAttribute('src')) fail(mediaError(e.currentTarget)) }}
        onTimeUpdate={e => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={e => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onDurationChange={e => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
      />
    </PlayerContext.Provider>
  )
}
