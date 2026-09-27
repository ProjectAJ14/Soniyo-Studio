import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { JobState } from '../../api/types'
import { getPairing } from '../../lib/pairing'

const ACTIVE: JobState[] = ['queued', 'compiling', 'generating', 'unit_ready', 'looping', 'encoding']
const POLL_MS = 10_000

/** Number of non-terminal jobs, for the Queue tab badge. 0 when unpaired or unreachable. */
export function useActiveJobCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    const tick = () => {
      if (!getPairing() || document.visibilityState === 'hidden') return
      api.listJobs(ACTIVE).then(
        r => { if (alive) setCount(r.items.length) },
        // The badge is decoration; the connection banner and screens report the real error.
        () => { if (alive) setCount(0) },
      )
    }
    tick()
    const t = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [])
  return count
}
