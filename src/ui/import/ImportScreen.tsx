import { useEffect, useState } from 'react'
import type { ListEntry, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import {
  WRITE_SPACING_MS,
  formatDuration,
  importSummary,
  timeLeftMs,
  type ImportState,
  type RunnerStatus,
} from '../../import/runner.ts'
import { displayTitle } from '../../pool/pool.ts'
import { formatLevel, levelOfRaw } from '../../ranking/scoring.ts'
import './import.css'

export type ImportStage = 'confirm' | 'running' | 'stopped' | 'done'

/**
 * Import ("cover grid", issue #10): a confirmation card before any write, then one cover per planned title that
 * lights up as it is written, a progress bar with the time left, and at the end the summary with a Retry for failures.
 */
export function ImportScreen(props: {
  stage: ImportStage
  state: ImportState
  status: RunnerStatus | null
  /** Set when a resumed Import's plan was recalculated: titles the earlier plan already wrote. */
  writtenBefore: number | null
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  format: ScoreFormat
  onConfirm: () => void
  onStop: () => void
  onResume: () => void
  onRetry: () => void
  onBack: () => void
}) {
  const { stage, state, status, entries, titleLanguage, format } = props
  const summary = importSummary(state)
  const name = (id: number) => {
    const entry = entries.get(id)
    return entry ? displayTitle(entry.title, titleLanguage) : `Title #${id}`
  }
  const now = useNow(stage === 'running')

  if (stage === 'confirm') {
    const n = summary.left
    return (
      <div className="im im-center">
        <div className="imconf">
          <div className="h2">
            Write {n} {n === 1 ? 'score' : 'scores'} to AniList?
          </div>
          {props.writtenBefore !== null && (
            <p className="warn">
              Your Ranking changed since the last Import — {props.writtenBefore} written already, {n} to write now.
            </p>
          )}
          <p>
            Only the <b>score</b> changes. Status, progress, notes and dates stay as they are. Forgotten and unticked titles
            are not touched.
          </p>
          <p className="small">
            Takes about {formatDuration(n * WRITE_SPACING_MS)}. You can close the tab — it carries on where it stopped next
            time.
          </p>
          <div className="row">
            <button className="go" disabled={n === 0} onClick={props.onConfirm}>
              Yes, write {n} {n === 1 ? 'score' : 'scores'}
            </button>
            <button className="link" onClick={props.onBack}>
              Back to Preview
            </button>
          </div>
        </div>
      </div>
    )
  }

  const processed = summary.total - summary.left
  const current = status?.phase === 'writing' && stage === 'running' ? status.mediaId : null
  const waiting = stage === 'running' && status?.phase === 'waiting'
  let heading: string
  let line: string
  if (stage === 'done') {
    heading = summary.failed === 0 ? 'All done!' : 'Almost done'
    line = `${summary.written} written`
  } else if (stage === 'stopped') {
    heading = `Stopped at ${processed}/${summary.total}`
    line = 'Nothing more is written until you resume'
  } else {
    heading = `Importing ${processed}/${summary.total}`
    const left = formatDuration(status ? timeLeftMs(state, status, now) : summary.left * WRITE_SPACING_MS)
    line =
      waiting && status?.phase === 'waiting'
        ? `AniList rate limit reached — waiting ${formatDuration(Math.max(0, status.until - now))}, then it carries on by itself · ${left} left`
        : status?.phase === 'reading'
          ? 'Checking your current scores on AniList'
          : `Writing about 1 every ${((status?.phase === 'writing' ? status.spacingMs : WRITE_SPACING_MS) / 1000).toFixed(1)} s to stay inside AniList's limit · ${left} left`
  }
  const failed = state.writes.filter((w) => w.status === 'failed')

  return (
    <div className="im im-grid">
      <div className="imtop">
        <div className="col">
          <div className="h2">{heading}</div>
          <span className={waiting ? 'small warn' : 'small'}>{line}</span>
        </div>
        <div className="grow" />
        {stage === 'running' && (
          <button className="link" onClick={props.onStop}>
            Stop
          </button>
        )}
        {stage === 'stopped' && (
          <button className="go" onClick={props.onResume}>
            Resume
          </button>
        )}
        {stage === 'done' && (
          <div className="imsum">
            <div>
              <b>{summary.written}</b>
              <span>written</span>
            </div>
            <div>
              <b>{summary.skipped}</b>
              <span>skipped (changed on AniList)</span>
            </div>
            <div className="bad">
              <b>{summary.failed}</b>
              <span>failed</span>
            </div>
          </div>
        )}
      </div>
      <div className="improg" role="progressbar" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={processed}>
        <i style={{ width: `${summary.total === 0 ? 100 : (processed / summary.total) * 100}%` }} />
      </div>

      <div className="cgrid">
        {state.writes.map((w) => {
          const entry = entries.get(w.mediaId)
          const cls = w.mediaId === current ? 'now' : w.status === 'done' ? 'ok' : w.status === 'failed' ? 'fail' : w.status === 'skipped' ? 'skip' : ''
          const badge = { done: '✓', failed: '✕', skipped: '–', pending: w.mediaId === current ? '…' : '' }[w.status]
          return (
            <div key={w.mediaId} className={`cg ${cls}`} title={`${name(w.mediaId)}${w.error ? ` — ${w.error}` : ''}`}>
              {entry?.coverUrl ? (
                <img className="cv" src={entry.coverUrl} alt="" style={{ ['--c' as string]: entry.coverColor ?? undefined }} />
              ) : (
                <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
              )}
              {badge && <span className="badge">{badge}</span>}
              <span className="sc">{formatLevel(format, levelOfRaw(format, w.scoreRaw))}</span>
            </div>
          )
        })}
      </div>

      {stage === 'done' && failed.length > 0 && (
        <div className="imfail">
          <b className="strong">Couldn't save</b>
          {failed.map((w) => (
            <div key={w.mediaId} className="frow">
              <span className="grow">{name(w.mediaId)}</span>
              <span className="small">{w.error ?? 'error'}</span>
            </div>
          ))}
          <button className="go" onClick={props.onRetry}>
            Retry {failed.length} failed
          </button>
        </div>
      )}
      {stage !== 'running' && (
        <button className="link imback" onClick={props.onBack}>
          ← Back to Preview
        </button>
      )}
    </div>
  )
}

/** The current time, refreshed every second while `ticking`, for the countdowns. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking])
  return now
}
