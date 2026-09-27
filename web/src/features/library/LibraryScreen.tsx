import { useEffect, useState } from 'react'
import { Play, Search, Star } from 'lucide-react'
import { api } from '../../api/client'
import type { Song } from '../../api/types'
import { href } from '../../app/router'
import { AsyncView, EmptyState } from '../../components/AsyncView'
import { useAsync, useMutation } from '../../lib/async'
import { formatBytes, formatDate, formatDuration } from '../../lib/format'
import { usePlayer } from '../player/PlayerProvider'
import './LibraryScreen.css'

export function LibraryScreen() {
  const [input, setInput] = useState('')
  const [q, setQ] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 300)
    return () => clearTimeout(t)
  }, [input])

  const [songs, reload] = useAsync(() => api.listSongs({ q, favourite: favOnly || undefined, limit: 100 }), [q, favOnly])
  // Preset names are a nicety: on failure rows just omit the label.
  const [presets] = useAsync(() => api.listPresets(), [])
  const presetName = (id: string | null) =>
    id && presets.status === 'success' ? presets.data.items.find(p => p.id === id)?.name : undefined

  const filtered = q !== '' || favOnly
  return (
    <>
      <div className="page-head">
        <h1>Library</h1>
        <span className="spacer" />
        {songs.status === 'success' && (
          <span className="label">
            {formatBytes(songs.data.storage.used_bytes)} used · {formatBytes(songs.data.storage.free_bytes)} free
          </span>
        )}
      </div>
      <div className="row library__tools">
        <label className="library__search">
          <Search size={16} aria-hidden />
          <input className="input" type="search" placeholder="Search titles" aria-label="Search songs"
            value={input} onChange={e => setInput(e.target.value)} />
        </label>
        <div className="seg" role="group" aria-label="Filter">
          <button type="button" aria-pressed={!favOnly} onClick={() => setFavOnly(false)}>All</button>
          <button type="button" aria-pressed={favOnly} onClick={() => setFavOnly(true)}>Favourites</button>
        </div>
      </div>
      <AsyncView state={songs} onRetry={reload} label="songs" isEmpty={d => d.items.length === 0}
        empty={filtered
          ? <EmptyState title="No matching songs"><p>Try another search or show all songs.</p></EmptyState>
          : <EmptyState title="No songs yet"><a className="btn btn--brand" href={href({ name: 'create' })}>Create a song</a></EmptyState>}>
        {d => (
          <ul className="library__list">
            {d.items.map(s => <SongRow key={`${s.id}:${s.favourite}`} song={s} preset={presetName(s.preset_id)} />)}
          </ul>
        )}
      </AsyncView>
    </>
  )
}

function SongRow({ song, preset }: { song: Song; preset?: string }) {
  const player = usePlayer()
  const [fav, setFav] = useState(song.favourite)
  const patch = useMutation(api.patchSong)
  const title = song.title || 'Untitled'

  const toggleFav = async () => {
    const prev = fav
    setFav(!prev) // optimistic
    if (!(await patch.mutate(song.id, { favourite: !prev }))) setFav(prev)
  }

  return (
    <li className="library__row">
      <button type="button" className="btn btn--ghost btn--icon" onClick={() => player.play(song)} aria-label={`Play ${title}`}>
        <Play size={16} aria-hidden />
      </button>
      <div className="library__info">
        <a className="library__title" href={href({ name: 'song', id: song.id })}>{title}</a>
        <span className="row library__meta">
          <span className="label">{formatDate(song.created_at)}</span>
          <span className="label">{formatDuration(song.duration_seconds)}</span>
          {preset && <span className="badge">{preset}</span>}
        </span>
        {patch.state.status === 'error' && (
          <span className="library__err" role="alert">Couldn't update favourite: {patch.state.error.message}</span>
        )}
      </div>
      <button type="button" className="btn btn--ghost btn--icon library__fav" aria-pressed={fav}
        aria-label={`Favourite ${title}`} disabled={patch.state.status === 'loading'} onClick={toggleFav}>
        <Star size={16} aria-hidden fill={fav ? 'currentColor' : 'none'} />
      </button>
    </li>
  )
}
