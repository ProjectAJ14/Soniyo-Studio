import { AlertTriangle, Download, Pause, Play, Repeat } from 'lucide-react'
import { api } from '../../api/client'
import { href } from '../../app/router'
import { formatDuration } from '../../lib/format'
import { usePlayer } from './PlayerProvider'
import './PlayerBar.css'

function safeDownloadUrl(id: string): string | undefined {
  try { return api.audioUrl(id, 'mp3', true) } catch { return undefined } // unpaired: hide the link
}

/** Publishes the bar's height as --player-h so Create's phone Generate bar can sit above it. */
function trackHeight(el: HTMLElement) {
  const root = document.documentElement.style
  const set = () => root.setProperty('--player-h', `${el.offsetHeight}px`)
  set()
  const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set)
  ro?.observe(el)
  return () => { ro?.disconnect(); root.removeProperty('--player-h') }
}

export function PlayerBar() {
  const p = usePlayer()
  if (p.state === 'idle' || !p.song) return null
  const playing = p.state === 'playing' || p.state === 'loading'
  const download = safeDownloadUrl(p.song.id)
  return (
    <section className="player" aria-label="Player" ref={trackHeight}>
      <button type="button" className="btn btn--brand btn--icon" onClick={p.toggle}
        aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
      </button>
      <div className="player__main">
        <div className="row player__meta">
          <a className="player__title" href={href({ name: 'song', id: p.song.id })}>{p.song.title || 'Untitled'}</a>
          {p.state === 'loading' && <span className="label" role="status">Loading</span>}
          {p.state === 'error' && (
            <span className="player__error" role="alert"><AlertTriangle size={14} aria-hidden /> {p.error}</span>
          )}
        </div>
        <div className="row player__seek">
          <span className="mono player__time" aria-hidden>{formatDuration(p.position)}</span>
          <input type="range" className="player__range" min={0} max={p.duration || 0} step={1}
            value={Math.min(p.position, p.duration || 0)} disabled={!p.duration}
            onChange={e => p.seek(Number(e.target.value))}
            aria-label="Seek" aria-valuetext={`${formatDuration(p.position)} of ${formatDuration(p.duration)}`} />
          <span className="mono player__time" aria-hidden>{formatDuration(p.duration)}</span>
        </div>
      </div>
      <button type="button" className="btn btn--ghost btn--icon" aria-pressed={p.loop} aria-label="Loop"
        onClick={() => p.setLoop(!p.loop)}>
        <Repeat size={16} aria-hidden />
      </button>
      {download && (
        <a className="btn btn--ghost btn--icon" href={download} download aria-label="Download MP3">
          <Download size={16} aria-hidden />
        </a>
      )}
    </section>
  )
}
