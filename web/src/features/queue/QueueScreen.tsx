import { useEffect, useState } from 'react'
import { CheckCircle2, Play, RotateCw, X } from 'lucide-react'
import { api } from '../../api/client'
import type { Job } from '../../api/types'
import { href } from '../../app/router'
import { AsyncView, EmptyState } from '../../components/AsyncView'
import { useMutation } from '../../lib/async'
import { formatDate, formatDuration } from '../../lib/format'
import { usePlayer } from '../player/PlayerProvider'
import { groupJobs, useJobs } from './useJobs'
import './QueueScreen.css'

const STAGES = ['compiling', 'generating', 'encoding'] as const
const stageOf = (s: Job['state']) => (s === 'unit_ready' || s === 'looping' ? 'generating' : s)

export function QueueScreen() {
  const { jobs, reload, upsert, live, ready, dismissReady } = useJobs()
  return (
    <>
      <div className="page-head">
        <h1>Queue</h1>
        <span className="spacer" />
        <span className="label">{live === 'sse' ? 'Live' : 'Updating every 5 s'}</span>
      </div>
      {ready && (
        <div className="card row queue__ready" role="status">
          <CheckCircle2 size={18} aria-hidden />
          <strong>Song ready</strong>
          <span className="muted">{ready.title || 'Untitled'}</span>
          <span className="spacer" />
          {ready.song_id && (
            <a className="btn btn--brand btn--sm" href={href({ name: 'song', id: ready.song_id })}>Open</a>
          )}
          <button type="button" className="btn btn--ghost btn--icon" aria-label="Dismiss" onClick={dismissReady}>
            <X size={16} aria-hidden />
          </button>
        </div>
      )}
      <AsyncView state={jobs} onRetry={reload} label="jobs" isEmpty={d => d.length === 0}
        empty={<EmptyState title="No jobs yet"><a href={href({ name: 'create' })}>Create a song</a></EmptyState>}>
        {d => <Groups jobs={d} upsert={upsert} reload={reload} />}
      </AsyncView>
    </>
  )
}

function Groups({ jobs, upsert, reload }: { jobs: Job[]; upsert: (j: Job) => void; reload: () => void }) {
  const { running, queued, recent } = groupJobs(jobs)
  return (
    <div className="stack">
      <section aria-labelledby="q-running" className="stack">
        <h2 id="q-running">Running</h2>
        {running.length === 0 ? <p>Nothing generating right now.</p> : running.map(j => <RunningJob key={j.id} job={j} />)}
      </section>
      <section aria-labelledby="q-queued" className="stack">
        <h2 id="q-queued">Queued</h2>
        {queued.length === 0 ? <p>No jobs waiting.</p> : (
          <ul className="queue__list">{queued.map(j => <QueuedJob key={j.id} job={j} onChange={upsert} />)}</ul>
        )}
      </section>
      <section aria-labelledby="q-recent" className="stack">
        <h2 id="q-recent">Recent</h2>
        {recent.length === 0 ? <p>No finished jobs yet.</p> : (
          <ul className="queue__list">{recent.map(j => <RecentJob key={j.id} job={j} onRetried={reload} />)}</ul>
        )}
      </section>
    </div>
  )
}

/** Counts from the server's value locally; re-keyed on every server update. */
function Ticking({ seconds, direction }: { seconds: number; direction: 1 | -1 }) {
  const [start] = useState(() => Date.now())
  const [now, setNow] = useState(start)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{formatDuration(Math.max(0, seconds + direction * (now - start) / 1000))}</>
}

function RunningJob({ job }: { job: Job }) {
  const current = stageOf(job.state)
  const at = STAGES.indexOf(current as (typeof STAGES)[number])
  return (
    <article className="card stack" aria-label={`Running: ${job.title || 'Untitled'}`}>
      <div className="row">
        <h3>{job.title || 'Untitled'}</h3>
        <span className="spacer" />
        <span className="badge badge--spot">Now</span>
      </div>
      <ol className="queue__stages" aria-label="Stage">
        {STAGES.map((s, i) => (
          <li key={s} className="queue__stage" data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}
            aria-current={i === at ? 'step' : undefined}>
            {s}
          </li>
        ))}
      </ol>
      <div className="row">
        <span><span className="label">Elapsed</span>{' '}
          <span className="mono"><Ticking key={`e${job.elapsed_seconds}`} seconds={job.elapsed_seconds ?? 0} direction={1} /></span></span>
        <span><span className="label">About</span>{' '}
          <span className="mono">{job.estimate_seconds_left == null ? '–'
            : <Ticking key={`l${job.estimate_seconds_left}`} seconds={job.estimate_seconds_left} direction={-1} />}</span>
          {' '}<span className="label">left</span></span>
      </div>
      <p>Progress is an estimate; the engine does not report exact progress.</p>
    </article>
  )
}

function QueuedJob({ job, onChange }: { job: Job; onChange: (j: Job) => void }) {
  const cancel = useMutation(api.cancelJob)
  const onCancel = async () => {
    const updated = await cancel.mutate(job.id)
    if (updated) onChange(updated)
  }
  return (
    <li className="queue__row">
      <span className="mono queue__pos" aria-label={`Position ${job.position ?? ''}`}>#{job.position ?? '–'}</span>
      <span className="queue__title">{job.title || 'Untitled'}</span>
      <span className="spacer" />
      {cancel.state.status === 'error' && <span className="queue__err" role="alert">{cancel.state.error.message}</span>}
      <button type="button" className="btn btn--danger btn--sm" onClick={onCancel}
        disabled={cancel.state.status === 'loading'} aria-label={`Cancel ${job.title || 'Untitled'}`}>
        {cancel.state.status === 'loading' ? 'Cancelling' : 'Cancel'}
      </button>
    </li>
  )
}

function RecentJob({ job, onRetried }: { job: Job; onRetried: () => void }) {
  const player = usePlayer()
  const retry = useMutation(api.retryJob)
  const title = job.title || 'Untitled'
  const onRetry = async () => { if (await retry.mutate(job.id)) onRetried() }
  return (
    <li className="queue__row">
      <span className={`badge ${job.state === 'succeeded' ? 'badge--spot' : job.state === 'failed' ? 'badge--error' : ''}`}>
        {job.state}
      </span>
      <span className="queue__title">
        {job.state === 'succeeded' && job.song_id
          ? <a href={href({ name: 'song', id: job.song_id })}>{title}</a>
          : title}
        {job.finished_at && <span className="label queue__when">{formatDate(job.finished_at)}</span>}
        {job.state === 'failed' && job.error && <span className="queue__err">{job.error.message}</span>}
      </span>
      <span className="spacer" />
      {job.state === 'succeeded' && job.song_id && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => player.play({ id: job.song_id!, title })}
          aria-label={`Play ${title}`}>
          <Play size={16} aria-hidden /> Play
        </button>
      )}
      {job.state === 'failed' && (
        <>
          {retry.state.status === 'error' && <span className="queue__err" role="alert">{retry.state.error.message}</span>}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}
            disabled={retry.state.status === 'loading'} aria-label={`Retry ${title}`}>
            <RotateCw size={16} aria-hidden /> {retry.state.status === 'loading' ? 'Retrying' : 'Retry'}
          </button>
        </>
      )}
    </li>
  )
}
