// F25 / U7: is the Mac up, is the engine healthy, what's loaded, how full is the disk.
import { useState, type ReactNode } from 'react'
import { AlertTriangle, RotateCw, Unlink } from 'lucide-react'
import { api } from '../../api/client'
import type { Health } from '../../api/types'
import { href } from '../../app/router'
import { AsyncView } from '../../components/AsyncView'
import { FieldSeg } from '../../components/FieldSeg'
import { useAsync } from '../../lib/async'
import { formatBytes } from '../../lib/format'
import { usePairing } from '../../lib/pairing'
import { getGround, setGround, type Ground } from '../../lib/theme'
import { forgetPairing } from './pairing'
import './server.css'

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <dt className="label">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

const ENGINE_DOT = { ok: 'dot--ok', down: 'dot--error', unknown: '' } as const

// `stale`: the latest check failed, so these numbers are from the last good one.
function Status({ health, at, stale }: { health: Health; at: Date; stale: boolean }) {
  const engine = health.engine
  const disk = health.disk
  return (
    <div className="stack">
      {disk?.low && (
        <div className="state state--error" role="alert">
          <div className="row">
            <AlertTriangle size={18} aria-hidden />
            <strong className="state__title">Disk space is low</strong>
          </div>
          <p>Only {formatBytes(disk.free_bytes)} free on the Mac. Delete songs you don't need before starting long renders.</p>
        </div>
      )}
      <dl className="stats">
        <Stat label="Mac">
          {stale
            ? <span className="row"><span className="dot dot--error" aria-hidden /> Not responding</span>
            : <span className="row"><span className="dot dot--ok" aria-hidden /> Reachable</span>}
        </Stat>
        <Stat label="Engine">
          <span className="row">
            <span className={`dot ${ENGINE_DOT[engine?.status ?? 'unknown']}`} aria-hidden />
            {engine ? (engine.status === 'ok' ? 'Healthy' : engine.status === 'down' ? 'Down' : 'Unknown') : 'Unknown'}
          </span>
          {engine?.last_error && <p className="mono stat__note">{engine.last_error}</p>}
        </Stat>
        <Stat label="Loaded models">
          {engine?.models.length ? (
            <span className="row">{engine.models.map(m => <span key={m} className="badge">{m}</span>)}</span>
          ) : <span className="muted">None reported</span>}
        </Stat>
        <Stat label="Queue">
          {health.queue_depth ?? '–'} {health.queue_depth === 1 ? 'job' : 'jobs'}
          {health.running_job_id && <> · <a href={href({ name: 'queue' })}>view running job</a></>}
        </Stat>
        <Stat label="Free disk">
          <span className="row">
            {disk ? `${formatBytes(disk.free_bytes)} of ${formatBytes(disk.total_bytes)}` : '–'}
            {disk?.low && <span className="badge badge--warn">Low</span>}
          </span>
        </Stat>
        <Stat label="Library size">{formatBytes(disk?.used_by_library_bytes)}</Stat>
        <Stat label="Gateway version"><span className="mono">{health.version}</span></Stat>
        <Stat label={stale ? 'Last reachable' : 'Last checked'}>{at.toLocaleTimeString()}</Stat>
      </dl>
    </div>
  )
}

function mask(token: string): string {
  return token.length <= 4 ? '••••' : `••••••••${token.slice(-4)}`
}

export function ServerScreen() {
  const [status, reload] = useAsync(async () => ({ health: await api.health(), at: new Date() }), [])
  const pairing = usePairing()
  const [ground, setGroundState] = useState<Ground>(getGround)

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack server__title">
          <span className="label">Server</span>
          <h1>Your <em>Mac</em></h1>
        </div>
        <span className="spacer" />
        <button type="button" className="btn btn--ghost" onClick={reload} disabled={status.status === 'loading'}>
          <RotateCw size={16} aria-hidden /> {status.status === 'loading' ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <section className="card stack" aria-labelledby="server-status">
        <div className="section-head">
          <span className="label">Status</span>
          <h2 id="server-status">Mac and engine</h2>
        </div>
        <AsyncView state={status} onRetry={reload} label="server status">
          {d => <Status health={d.health} at={d.at} stale={status.status === 'error'} />}
        </AsyncView>
      </section>

      <section className="card stack" aria-labelledby="server-pairing">
        <div className="section-head">
          <span className="label">Pairing</span>
          <h2 id="server-pairing">This device</h2>
        </div>
        {pairing && (
          <dl className="stats">
            <Stat label="Gateway URL"><span className="mono break">{pairing.baseUrl}</span></Stat>
            <Stat label="Owner token"><span className="mono">{mask(pairing.token)}</span></Stat>
          </dl>
        )}
        <div className="row">
          <button type="button" className="btn btn--danger"
            onClick={() => { if (confirm('Forget this pairing? You will need the owner token to pair again.')) forgetPairing() }}>
            <Unlink size={16} aria-hidden /> Forget pairing
          </button>
        </div>
      </section>

      <section className="card stack" aria-labelledby="server-appearance">
        <div className="section-head">
          <span className="label">Appearance</span>
          <h2 id="server-appearance">Ground</h2>
        </div>
        <FieldSeg label="Ground" options={['ink', 'paper'] as const} value={ground}
          onChange={g => { setGround(g); setGroundState(g) }} />
      </section>
    </div>
  )
}
