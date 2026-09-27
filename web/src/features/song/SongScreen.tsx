import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, Check, Copy, Download, Pencil, Play, RefreshCw, Share2, Shuffle, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import { api } from '../../api/client'
import type { Song } from '../../api/types'
import { href, navigate } from '../../app/router'
import { AsyncView, EmptyState } from '../../components/AsyncView'
import { useAsync, useMutation } from '../../lib/async'
import { setDraft } from '../../lib/draft'
import { formatBytes, formatDate, formatDuration } from '../../lib/format'
import { usePlayer } from '../player/PlayerProvider'
import './SongScreen.css'

const TITLE_MAX = 200

export function SongScreen({ id }: { id: string }) {
  const [song, reload, set] = useAsync(() => api.getSong(id), [id])
  if (song.status === 'error' && song.error.status === 404) {
    return (
      <EmptyState title="Song not found">
        <p>It may have been deleted.</p>
        <a className="btn btn--ghost" href={href({ name: 'library' })}><ArrowLeft size={16} aria-hidden /> Back to library</a>
      </EmptyState>
    )
  }
  return (
    <AsyncView state={song} onRetry={reload} label="song">
      {s => <SongDetail song={s} onChange={set} />}
    </AsyncView>
  )
}

function SongDetail({ song, onChange }: { song: Song; onChange: (s: Song) => void }) {
  const player = usePlayer()
  const regen = useMutation(api.regenerateSong)
  const onRegen = async (seed: 'same' | 'new') => { if (await regen.mutate(song.id, seed)) navigate({ name: 'queue' }) }
  const editAndRegenerate = () => { setDraft({ ...song.spec, title: song.title }); navigate({ name: 'create' }) }

  return (
    <div className="stack">
      <a className="song__back" href={href({ name: 'library' })}><ArrowLeft size={16} aria-hidden /> Library</a>
      <Title song={song} onChange={onChange} />
      <div className="row song__meta">
        <Meta label="Created">{formatDate(song.created_at)}</Meta>
        <Meta label="Duration">{formatDuration(song.duration_seconds)}</Meta>
        <Meta label="Seed">{song.seed ?? '–'}</Meta>
        <Meta label="Size">{formatBytes(song.size_bytes)}</Meta>
      </div>

      <section className="card stack" aria-label="Actions">
        <div className="row">
          <button type="button" className="btn btn--brand" onClick={() => player.play(song)}>
            <Play size={16} aria-hidden /> Play
          </button>
          <a className="btn btn--ghost" href={api.audioUrl(song.id, 'mp3', true)} download>
            <Download size={16} aria-hidden /> Download MP3
          </a>
          <a className="btn btn--ghost" href={api.audioUrl(song.id, 'flac', true)} download>
            <Download size={16} aria-hidden /> Download FLAC
          </a>
          <ShareButton title={song.title} />
        </div>
        <div className="row">
          <button type="button" className="btn btn--ghost" disabled={regen.state.status === 'loading' || song.seed === null}
            title={song.seed === null ? 'No seed was recorded for this song; use Variation.' : undefined} onClick={() => onRegen('same')}>
            <RefreshCw size={16} aria-hidden /> Regenerate
          </button>
          <button type="button" className="btn btn--ghost" disabled={regen.state.status === 'loading'} onClick={() => onRegen('new')}>
            <Shuffle size={16} aria-hidden /> Variation
          </button>
          <button type="button" className="btn btn--ghost" onClick={editAndRegenerate}>
            <SlidersHorizontal size={16} aria-hidden /> Edit and regenerate
          </button>
          <span className="spacer" />
          <DeleteButton song={song} />
        </div>
        {regen.state.status === 'loading' && <p role="status">Queueing</p>}
        {regen.state.status === 'error' && <p className="song__err" role="alert">{regen.state.error.message}</p>}
      </section>

      <Settings song={song} />

      <section className="stack" aria-labelledby="song-lyrics">
        <h2 id="song-lyrics">Lyrics</h2>
        {song.spec.lyrics.text.trim() ? <p className="song__lyrics">{song.spec.lyrics.text}</p> : <p>Instrumental, no lyrics.</p>}
      </section>

      <section className="stack" aria-labelledby="song-compiled">
        <h2 id="song-compiled">Compiled prompt</h2>
        <span className="label">Caption</span>
        <div className="code">{song.compiled.caption || '–'}</div>
        <span className="label">Negative prompt</span>
        <div className="code">{song.compiled.negative_prompt || '–'}</div>
      </section>

      <section className="stack" aria-labelledby="song-engine">
        <h2 id="song-engine">Engine</h2>
        {Object.keys(song.engine_info).length === 0 ? <p>No engine details recorded.</p> : (
          <dl className="song__dl">
            {Object.entries(song.engine_info).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}
          </dl>
        )}
      </section>
    </div>
  )
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return <span className="song__metaitem"><span className="label">{label}</span> <span className="mono">{children}</span></span>
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <><dt className="label">{label}</dt><dd>{children}</dd></>
}

function Title({ song, onChange }: { song: Song; onChange: (s: Song) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(song.title)
  const [invalid, setInvalid] = useState<string | null>(null)
  const rename = useMutation(api.patchSong)
  const fav = useMutation(api.patchSong)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const title = value.trim()
    if (!title) return setInvalid('Title cannot be empty.')
    if (title.length > TITLE_MAX) return setInvalid(`Keep the title under ${TITLE_MAX} characters.`)
    setInvalid(null)
    const updated = await rename.mutate(song.id, { title })
    if (updated) { onChange(updated); setEditing(false) }
  }

  const toggleFav = async () => {
    const updated = await fav.mutate(song.id, { favourite: !song.favourite })
    if (updated) onChange(updated)
  }

  if (editing) {
    return (
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="song-title">Title</label>
          <input id="song-title" className="input" value={value} autoFocus maxLength={TITLE_MAX + 50}
            onChange={e => setValue(e.target.value)} aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'song-title-err' : undefined} />
          {invalid && <span id="song-title-err" className="song__err" role="alert">{invalid}</span>}
          {rename.state.status === 'error' && <span className="song__err" role="alert">{rename.state.error.message}</span>}
        </div>
        <div className="row">
          <button type="submit" className="btn btn--brand btn--sm" disabled={rename.state.status === 'loading'}>
            <Check size={16} aria-hidden /> {rename.state.status === 'loading' ? 'Saving' : 'Save'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm"
            onClick={() => { setEditing(false); setValue(song.title); setInvalid(null); rename.reset() }}>
            <X size={16} aria-hidden /> Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="row">
      <h1 className="song__title">{song.title || 'Untitled'}</h1>
      <button type="button" className="btn btn--ghost btn--icon" aria-label="Rename"
        onClick={() => { setValue(song.title); setEditing(true) }}>
        <Pencil size={16} aria-hidden />
      </button>
      <button type="button" className="btn btn--ghost btn--icon song__fav" aria-label="Favourite" aria-pressed={song.favourite}
        disabled={fav.state.status === 'loading'} onClick={toggleFav}>
        <Star size={16} aria-hidden fill={song.favourite ? 'currentColor' : 'none'} />
      </button>
      {fav.state.status === 'error' && <span className="song__err" role="alert">{fav.state.error.message}</span>}
    </div>
  )
}

function ShareButton({ title }: { title: string }) {
  const share = useMutation(async (): Promise<'shared' | 'copied'> => {
    const url = location.href
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url })
        return 'shared'
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'shared' // user closed the sheet
        throw e
      }
    }
    if (!navigator.clipboard) throw new Error('Sharing is not available in this browser.')
    await navigator.clipboard.writeText(url)
    return 'copied'
  })
  return (
    <>
      <button type="button" className="btn btn--ghost" disabled={share.state.status === 'loading'} onClick={() => share.mutate()}>
        {share.state.status === 'success' && share.state.data === 'copied'
          ? <><Copy size={16} aria-hidden /> Link copied</>
          : <><Share2 size={16} aria-hidden /> Share</>}
      </button>
      {share.state.status === 'error' && <span className="song__err" role="alert">{share.state.error.message}</span>}
    </>
  )
}

function DeleteButton({ song }: { song: Song }) {
  const [confirming, setConfirming] = useState(false)
  const player = usePlayer()
  const del = useMutation((id: string) => api.deleteSong(id).then(() => true))
  const onDelete = async () => {
    if (!(await del.mutate(song.id))) return
    if (player.song?.id === song.id) player.stop()
    navigate({ name: 'library' })
  }

  if (!confirming) {
    return (
      <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
        <Trash2 size={16} aria-hidden /> Delete
      </button>
    )
  }
  return (
    <div className="row song__confirm" role="group" aria-label="Confirm delete">
      <span>Delete this song and its audio files?</span>
      <button type="button" className="btn btn--danger" disabled={del.state.status === 'loading'} onClick={onDelete}>
        <Trash2 size={16} aria-hidden /> {del.state.status === 'loading' ? 'Deleting' : 'Yes, delete'}
      </button>
      <button type="button" className="btn btn--ghost" disabled={del.state.status === 'loading'}
        onClick={() => { setConfirming(false); del.reset() }}>
        Keep
      </button>
      {del.state.status === 'error' && <span className="song__err" role="alert">{del.state.error.message}</span>}
    </div>
  )
}

function Settings({ song }: { song: Song }) {
  const s = song.spec
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '–')
  const vocals = s.vocals.type === 'none' ? 'None' : [
    s.vocals.type, s.vocals.delivery, s.vocals.language, s.vocals.character.join(', '), s.vocals.notes,
  ].filter(Boolean).join(' · ')
  const music = [
    s.music.bpm ? `${s.music.bpm} BPM` : null, s.music.key, s.music.time_signature ? `${s.music.time_signature}/4` : null,
  ].filter(Boolean).join(' · ') || 'Auto'
  return (
    <section className="stack" aria-labelledby="song-settings">
      <h2 id="song-settings">Builder settings</h2>
      <dl className="song__dl">
        <Row label="Theme">{[s.theme.deity, s.theme.form].filter(Boolean).join(' · ') || '–'}</Row>
        <Row label="Style">{s.style || '–'}</Row>
        <Row label="Moods">{list(s.moods)}</Row>
        <Row label="Vocals">{vocals}</Row>
        <Row label="Ambience">{`${s.ambience.reverb} reverb · ${s.ambience.space} · ${s.ambience.dynamics}`}</Row>
        <Row label="Avoid">{list(s.avoid)}</Row>
        <Row label="Music">{music}</Row>
        <Row label="Length">{formatDuration(s.length.total_seconds)}</Row>
      </dl>
      {s.instruments.length === 0 ? <p>No instruments specified.</p> : (
        <div className="song__tablewrap">
          <table className="song__table">
            <caption className="visually-hidden">Instruments</caption>
            <thead><tr><th scope="col">Instrument</th><th scope="col">Role</th><th scope="col">Level</th><th scope="col">Frequency</th></tr></thead>
            <tbody>
              {s.instruments.map((i, n) => (
                <tr key={`${i.name}-${n}`}><td>{i.name}</td><td>{i.role}</td><td>{i.level}</td><td>{i.frequency ?? '–'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
