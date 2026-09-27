// Hash routing: works from Firebase, the gateway's `/`, and the Home Screen app alike.
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'create' }
  | { name: 'queue' }
  | { name: 'library' }
  | { name: 'song'; id: string }
  | { name: 'server' }

export function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/')
  if (a === 'songs' && b) return { name: 'song', id: decodeURIComponent(b) }
  if (a === 'queue' || a === 'library' || a === 'server') return { name: a }
  return { name: 'create' }
}

export function href(route: Route): string {
  return route.name === 'song' ? `#/songs/${encodeURIComponent(route.id)}` : `#/${route.name}`
}

export function navigate(route: Route): void {
  location.hash = href(route)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    cb => { addEventListener('hashchange', cb); return () => removeEventListener('hashchange', cb) },
    () => location.hash,
  )
  return parse(hash)
}
