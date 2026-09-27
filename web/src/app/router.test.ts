import { describe, expect, it } from 'vitest'
import { href, parse } from './router'

describe('router', () => {
  it('round-trips every route', () => {
    for (const r of [{ name: 'create' }, { name: 'queue' }, { name: 'library' }, { name: 'server' }, { name: 'song', id: 'a b' }] as const) {
      expect(parse(href(r))).toEqual(r)
    }
  })
  it('falls back to create', () => expect(parse('#/nope')).toEqual({ name: 'create' }))
})
