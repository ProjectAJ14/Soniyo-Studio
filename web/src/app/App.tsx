import { Library, ListMusic, Server, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePairing } from '../lib/pairing'
import { href, useRoute, type Route } from './router'
import { CreateScreen } from '../features/create/CreateScreen'
import { QueueScreen } from '../features/queue/QueueScreen'
import { useActiveJobCount } from '../features/queue/useActiveJobCount'
import { LibraryScreen } from '../features/library/LibraryScreen'
import { SongScreen } from '../features/song/SongScreen'
import { ServerScreen } from '../features/server/ServerScreen'
import { PairingScreen } from '../features/server/PairingScreen'
import { ConnectionProvider, ConnectionBanner } from '../features/server/connection'
import { PlayerProvider } from '../features/player/PlayerProvider'
import { PlayerBar } from '../features/player/PlayerBar'

const TABS: { route: Route; label: string; icon: ReactNode }[] = [
  { route: { name: 'create' }, label: 'Create', icon: <Sparkles size={18} aria-hidden /> },
  { route: { name: 'queue' }, label: 'Queue', icon: <ListMusic size={18} aria-hidden /> },
  { route: { name: 'library' }, label: 'Library', icon: <Library size={18} aria-hidden /> },
  { route: { name: 'server' }, label: 'Server', icon: <Server size={18} aria-hidden /> },
]

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'create': return <CreateScreen />
    case 'queue': return <QueueScreen />
    case 'library': return <LibraryScreen />
    case 'song': return <SongScreen id={route.id} />
    case 'server': return <ServerScreen />
  }
}

function Shell() {
  const route = useRoute()
  const active = useActiveJobCount()
  const current = route.name === 'song' ? 'library' : route.name
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={href({ name: 'create' })}>
          <span className="brand__tile" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          </span>
          Soniyo
        </a>
        <nav className="tabs" aria-label="Main">
          {TABS.map(t => (
            <a key={t.label} className="tab" href={href(t.route)} aria-current={current === t.route.name ? 'page' : undefined}>
              {t.icon}
              <span className="tab__text">{t.label}</span>
              {t.route.name === 'queue' && active > 0 && (
                <span className="tab__badge" aria-label={`${active} active jobs`}>{active}</span>
              )}
            </a>
          ))}
        </nav>
      </header>
      <ConnectionBanner />
      <main className="main">
        <Screen route={route} />
      </main>
      <PlayerBar />
    </div>
  )
}

export function App() {
  const pairing = usePairing()
  if (!pairing) return <PairingScreen />
  return (
    <ConnectionProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </ConnectionProvider>
  )
}
