// Live job list for the Queue screen: SSE per non-terminal job (F17), 5 s polling
// fallback, refresh when the tab comes back after sleep (F18).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { Job } from '../../api/types'
import { TERMINAL_STATES } from '../../api/types'
import { dataOf, useAsync, type AsyncState } from '../../lib/async'

export const POLL_MS = 5_000
export const isTerminal = (j: Job) => TERMINAL_STATES.includes(j.state)

/** Running (position 0), Queued by position, Recent (terminal, newest first as served). */
export function groupJobs(jobs: Job[]) {
  return {
    running: jobs.filter(j => !isTerminal(j) && j.state !== 'queued'),
    queued: jobs.filter(j => j.state === 'queued').sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    recent: jobs.filter(isTerminal),
  }
}

export interface JobsView {
  jobs: AsyncState<Job[]>
  reload: () => void
  /** Replace one job in the list (after a mutation or an SSE event). */
  upsert: (job: Job) => void
  live: 'sse' | 'polling'
  /** A watched job that just finished successfully. */
  ready: Job | null
  dismissReady: () => void
}

export function useJobs(): JobsView {
  const [jobs, reload, set] = useAsync(() => api.listJobs().then(r => r.items), [])
  const [polling, setPolling] = useState(() => typeof EventSource === 'undefined')
  const [ready, setReady] = useState<Job | null>(null)

  const latest = useRef<Job[] | undefined>(undefined)
  useLayoutEffect(() => { latest.current = dataOf(jobs) })

  const upsert = useCallback((job: Job) => {
    const list = latest.current ?? []
    const next = list.some(j => j.id === job.id) ? list.map(j => (j.id === job.id ? job : j)) : [job, ...list]
    latest.current = next
    set(next)
  }, [set])

  // Detect transitions in one place so SSE and polling behave the same.
  const seen = useRef(new Map<string, Job['state']>())
  const list = dataOf(jobs)
  useEffect(() => {
    if (!list) return
    let finished = false
    for (const j of list) {
      const before = seen.current.get(j.id)
      if (before && !TERMINAL_STATES.includes(before) && isTerminal(j)) {
        finished = true
        // oxlint-disable-next-line react/set-state-in-effect -- reacting to an external transition
        if (j.state === 'succeeded') setReady(j)
      }
      seen.current.set(j.id, j.state)
    }
    // Queue positions shift when a job ends; the per-job streams don't carry that.
    if (finished) reload()
  }, [list, reload])

  const activeKey = (list ?? []).filter(j => !isTerminal(j)).map(j => j.id).sort().join(',')

  // One EventSource per non-terminal job.
  const sources = useRef(new Map<string, EventSource>())
  useEffect(() => {
    const open = sources.current
    const ids = new Set(activeKey ? activeKey.split(',') : [])
    for (const [id, es] of open) if (!ids.has(id) || polling) { es.close(); open.delete(id) }
    if (polling) return
    for (const id of ids) {
      if (open.has(id)) continue
      let es: EventSource
      try {
        es = new EventSource(api.jobEventsUrl(id))
      } catch {
        // oxlint-disable-next-line react/set-state-in-effect -- external failure opening the stream
        setPolling(true) // unpaired or EventSource unsupported: polling surfaces the real error
        return
      }
      open.set(id, es)
      es.addEventListener('job', e => {
        let job: Job
        try { job = JSON.parse((e as MessageEvent<string>).data) as Job } catch { return } // malformed frame: next one or the poll corrects it
        upsert(job)
        if (isTerminal(job)) { es.close(); open.delete(id) } // server closes after terminal; don't auto-reconnect
      })
      es.onerror = () => { es.close(); open.delete(id); setPolling(true) }
    }
  }, [activeKey, polling, upsert])

  useEffect(() => () => {
    for (const es of sources.current.values()) es.close()
    sources.current.clear()
  }, [])

  // Polling fallback, only while something can still change.
  useEffect(() => {
    if (!polling || !activeKey) return
    const t = setInterval(reload, POLL_MS)
    return () => clearInterval(t)
  }, [polling, activeKey, reload])

  // Tab reopened (iPad woke up): refresh and give SSE another chance.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      reload()
      if (typeof EventSource !== 'undefined') setPolling(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [reload])

  const dismissReady = useCallback(() => setReady(null), [])
  return { jobs, reload, upsert, live: polling ? 'polling' : 'sse', ready, dismissReady }
}
