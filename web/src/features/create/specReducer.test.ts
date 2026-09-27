import { describe, expect, it } from 'vitest'
import { emptySpec, type Instrument } from '../../api/types'
import { specReducer, validateSpec } from './specReducer'

const ins = (name: string): Instrument => ({ name, role: 'supporting', level: 'present', frequency: null })

describe('specReducer', () => {
  it('replace drops a stale client_job_id and does not alias the source', () => {
    const src = { ...emptySpec(), client_job_id: 'old', moods: ['calm'] }
    const out = specReducer(emptySpec(), { type: 'replace', spec: src })
    expect(out.client_job_id).toBeUndefined()
    expect(out.moods).toEqual(['calm'])
    expect(out.moods).not.toBe(src.moods)
  })

  it('patches a section without touching siblings', () => {
    const out = specReducer(emptySpec(), { type: 'patch', section: 'vocals', patch: { type: 'none' } })
    expect(out.vocals.type).toBe('none')
    expect(out.vocals.delivery).toBe('sing')
  })

  it('toggles and adds list values case-insensitively', () => {
    let s = specReducer(emptySpec(), { type: 'toggle', list: 'avoid', value: 'EDM' })
    expect(s.avoid).toEqual(['EDM'])
    s = specReducer(s, { type: 'add', list: 'avoid', value: ' edm ' })
    expect(s.avoid).toEqual(['EDM'])
    s = specReducer(s, { type: 'add', list: 'character', value: 'warm' })
    expect(s.vocals.character).toEqual(['warm'])
    s = specReducer(s, { type: 'toggle', list: 'avoid', value: 'EDM' })
    expect(s.avoid).toEqual([])
  })

  it('keeps frequency only for accents', () => {
    let s = specReducer(emptySpec(), { type: 'addInstrument', instrument: ins('bell') })
    s = specReducer(s, { type: 'updateInstrument', index: 0, patch: { role: 'accent' } })
    expect(s.instruments[0].frequency).toBe('occasional')
    s = specReducer(s, { type: 'updateInstrument', index: 0, patch: { frequency: 'rare' } })
    expect(s.instruments[0].frequency).toBe('rare')
    s = specReducer(s, { type: 'updateInstrument', index: 0, patch: { role: 'lead' } })
    expect(s.instruments[0].frequency).toBeNull()
  })

  it('moves and removes instruments, ignoring out-of-range moves', () => {
    let s = emptySpec()
    for (const n of ['a', 'b', 'c']) s = specReducer(s, { type: 'addInstrument', instrument: ins(n) })
    s = specReducer(s, { type: 'moveInstrument', from: 2, to: 0 })
    expect(s.instruments.map(i => i.name)).toEqual(['c', 'a', 'b'])
    expect(specReducer(s, { type: 'moveInstrument', from: 0, to: 3 })).toBe(s)
    s = specReducer(s, { type: 'removeInstrument', index: 1 })
    expect(s.instruments.map(i => i.name)).toEqual(['c', 'b'])
  })
})

describe('validateSpec', () => {
  it('accepts defaults', () => expect(validateSpec(emptySpec())).toEqual({}))
  it('flags out-of-range bpm, duration, repeat, temperature', () => {
    const s = emptySpec()
    s.music.bpm = 29
    s.length.total_seconds = 601
    s.lyrics.repeat = 0
    s.engine.lm_temperature = 2.5
    expect(Object.keys(validateSpec(s)).sort()).toEqual(['bpm', 'duration', 'repeat', 'temperature'])
    s.music.bpm = 60.5
    expect(validateSpec(s).bpm).toBeDefined()
  })
  it('flags lyrics that blow past the gateway cap once repeated', () => {
    const s = emptySpec()
    s.lyrics = { text: 'x'.repeat(100), repeat: 1000 }
    expect(validateSpec(s).lyrics).toBeDefined()
    s.lyrics.repeat = 500
    expect(validateSpec(s).lyrics).toBeUndefined()
  })
})
