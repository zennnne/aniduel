import { useEffect, useState, type ReactNode } from 'react'
import type { MediaType, TitleLanguage } from '../../anilist/types.ts'
import { markCounts, type CatchUpMark } from '../../catchup/batch.ts'
import { queueProgress, type QueueSnapshot } from '../../catchup/queue.ts'
import { BATCH_SIZE } from '../../catchup/suggest.ts'
import { displayTitle } from '../../pool/pool.ts'
import { EXT_ICON } from '../icons.tsx'
import { statusLabel } from '../start/statusLabel.ts'
import type { CatchUpView } from '../../catchup/visit.ts'
import './catchup.css'

const MARK_CLASS: Record<CatchUpMark, string> = { COMPLETED: 'c', CURRENT: 'r', DROPPED: 'd', PLANNING: 'p', PAUSED: 'u' }

/** What a batch is, after "Batch N" and while the first one loads. */
const SUGGESTED: Record<MediaType, string> = { ANIME: 'anime you’ve probably watched', MANGA: 'manga you’ve probably read' }

/** "2013 · TV", "2016 · MOVIE". */
function metaOf(year: number | null, format: string | null): string {
  return [year, format?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
}

/** "Saving 12/20" with a bar, "2 failed", "✓ all saved", or nothing before the first save. */
function QueueStatus(props: { queue: QueueSnapshot }) {
  const { state, running, status } = props.queue
  if (!state || state.writes.length === 0) return null
  const progress = queueProgress(state)
  if (running && progress.left > 0) {
    const waiting = status?.phase === 'waiting'
    return (
      <span className="cu-qs" role="status">
        {waiting ? 'Waiting for AniList’s rate limit' : `Saving ${progress.saved}/${progress.total}`}
        <span className="cu-bar">
          <i style={{ width: `${(progress.saved / Math.max(1, progress.total)) * 100}%` }} />
        </span>
      </span>
    )
  }
  if (progress.failed.length > 0) {
    return (
      <span className="cu-qs failed" role="status">
        {progress.failed.length} failed
      </span>
    )
  }
  if (progress.total === 0) return null
  return (
    <span className="cu-qs done" role="status">
      ✓ all saved
    </span>
  )
}

/**
 * Catch-up (#49, UI decisions on #37 from prototype #42): a grid of 20 covers. Tapping a cover cycles through the
 * marks (anime: Completed → Dropped → Planning → Paused; manga: Completed → Reading → Paused → Dropped → Planning) then
 * none; ⋯ picks a mark directly; ↗ opens the title on AniList (#54). "Save & next 20" queues the marks and shows the
 * next batch.
 */
export function CatchUpScreen(props: {
  mediaType: MediaType
  /** The visit's marks, in the order a tap steps through them. */
  marks: readonly CatchUpMark[]
  view: CatchUpView
  queue: QueueSnapshot
  titleLanguage: TitleLanguage
  onBack: () => void
  /** Loads the first batch again after a failure. */
  onReload: () => void
  onCycle: (id: number) => void
  onMark: (id: number, mark: CatchUpMark | null) => void
  onSave: () => void
  onRetryWrites: () => void
  /** Beside "Batch N": the Starting era chip (#51). */
  batchExtra?: ReactNode
  /** The body while the view asks the Starting era (#51). */
  eraQuestion?: ReactNode
  /** Right of the queue status: the exit offer (#52). */
  headerAction?: ReactNode
}) {
  const { view, queue } = props
  const [menuFor, setMenuFor] = useState<number | null>(null)

  useEffect(() => {
    if (menuFor === null) return
    const close = () => setMenuFor(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuFor])

  const failed = queue.state ? queueProgress(queue.state).failed : []
  const batch = view.phase === 'ready' ? view.batch : null
  const counts = batch ? markCounts(batch) : null

  return (
    <div className="cu">
      <header className="cu-top">
        <button className="cu-back" aria-label="Back" onClick={props.onBack}>
          ←
        </button>
        <h1>Catch-up</h1>
        {batch && (
          <span className="cu-batch">
            Batch {batch.number}
            <span className="hide-m"> · {BATCH_SIZE} {SUGGESTED[props.mediaType]}</span>
            {props.batchExtra}
          </span>
        )}
        <span className="grow" />
        <QueueStatus queue={queue} />
        {props.headerAction}
      </header>

      {failed.length > 0 && (
        <div className="cu-failbar" role="alert">
          <span className="grow">
            ✕ {failed.length === 1 ? '1 save' : `${failed.length} saves`} didn’t reach AniList ({failed.map((w) => w.name).join(', ')})
          </span>
          {queue.running ? (
            <span className="small">Retry once the others are saved</span>
          ) : (
            <button onClick={props.onRetryWrites}>Retry</button>
          )}
        </div>
      )}

      <div className="cu-body">
        {view.phase === 'loading' || view.phase === 'idle' ? (
          <div className="cu-center">
            <p className="cu-h2">Finding {SUGGESTED[props.mediaType]}…</p>
            <p className="small">Reading your list and what it links to on AniList. A long list can take a minute.</p>
          </div>
        ) : view.phase === 'era' ? (
          props.eraQuestion
        ) : view.phase === 'failed' ? (
          <div className="cu-center">
            <p className="cu-h2">Couldn’t load suggestions</p>
            <p className="small">{view.message}</p>
            <button className="go" onClick={props.onReload}>
              Try again
            </button>
          </div>
        ) : view.batch.suggestions.length === 0 ? (
          <div className="cu-center">
            <p className="cu-h2">That’s everything for now</p>
            <p className="small">New suggestions appear as you add more.</p>
          </div>
        ) : (
          <>
            <p className="cu-legend">
              Tap a cover:
              {props.marks.map((m) => (
                <span key={m}>
                  {' '}
                  <span className={`cu-dot ${MARK_CLASS[m]}`} />
                  {statusLabel(m, props.mediaType)} →
                </span>
              ))}{' '}
              none, or use ⋯. Leave the rest alone.
            </p>
            <div className="cu-grid">
              {view.batch.suggestions.map(({ media }) => {
                const mark = view.batch.marks.get(media.id)
                const name = displayTitle(media.title, props.titleLanguage)
                return (
                  <div key={media.id} className={mark ? 'cu-tile has' : 'cu-tile'}>
                    <div className="cu-art">
                      <button
                        className={mark ? `cu-cover marked-${MARK_CLASS[mark]}` : 'cu-cover'}
                        style={{ backgroundColor: media.coverColor ?? undefined }}
                        aria-label={`${name}: ${mark ? statusLabel(mark, props.mediaType) : 'not marked'}. Tap to change.`}
                        onClick={() => props.onCycle(media.id)}
                      >
                        {media.coverUrl ? <img src={media.coverUrl} alt="" loading="lazy" /> : <span className="cu-noimg">{name}</span>}
                        {mark && <span className={`cu-ribbon ${MARK_CLASS[mark]}`}>{statusLabel(mark, props.mediaType)}</span>}
                      </button>
                      <a className="cu-ext" aria-label={`Open ${name} on AniList`} title="Open on AniList" href={media.siteUrl} target="_blank" rel="noreferrer">
                        {EXT_ICON}
                      </a>
                    </div>
                    <button
                      className="cu-more"
                      aria-label={`Mark ${name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === media.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuFor(menuFor === media.id ? null : media.id)
                      }}
                    >
                      ⋯
                    </button>
                    {menuFor === media.id && (
                      <div className="cu-pop" role="menu" onClick={(e) => e.stopPropagation()}>
                        {props.marks.map((m) => (
                          <button
                            key={m}
                            role="menuitem"
                            onClick={() => {
                              props.onMark(media.id, m)
                              setMenuFor(null)
                            }}
                          >
                            <span className={`cu-dot ${MARK_CLASS[m]}`} />
                            {statusLabel(m, props.mediaType)}
                            {mark === m && ' ✓'}
                          </button>
                        ))}
                        {mark && (
                          <button
                            role="menuitem"
                            onClick={() => {
                              props.onMark(media.id, null)
                              setMenuFor(null)
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                    <div className="cu-ttl" title={name}>
                      {name}
                    </div>
                    <div className="cu-meta">{metaOf(media.year, media.format)}</div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {batch && counts && batch.suggestions.length > 0 && (
        <footer className="cu-foot">
          <span className="cu-sum">
            {props.marks.map((m) => (
              <span key={m}>
                <span className={`cu-dot ${MARK_CLASS[m]}`} />
                {counts[m]} {statusLabel(m, props.mediaType)}{' '}
              </span>
            ))}
            <span className="cu-pass">· {counts.passed} Passed (hidden 30 days)</span>
          </span>
          <span className="grow" />
          <button className="go" onClick={props.onSave}>
            Save &amp; next {BATCH_SIZE} →
          </button>
        </footer>
      )}
    </div>
  )
}
