import { useMemo, useState } from 'react'
import type { ListEntry, MediaType, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import type { AnchorScore } from '../../ranking/engine.ts'
import { count, pluralWord } from '../meta.ts'
import { statusLabel } from '../start/statusLabel.ts'
import './picker.css'
import { pickerView, togglePick } from './pickerView.ts'

/**
 * The Picker (#64, ADR 0011): the user ticks the titles a Keep My Scale Ranking will score. A plain layout; the final
 * look comes with #67. Every decision comes from `pickerView`. The picks live in this component only: leaving the
 * Picker drops them, and the next visit starts again from `initialPicks` (#61).
 */
export function PickerScreen(props: {
  list: readonly ListEntry[]
  scoreFormat: ScoreFormat
  titleLanguage: TitleLanguage
  mediaType: MediaType
  /** The picks it opens with (`startingPicks`). */
  initialPicks: ReadonlySet<number>
  onBack: () => void
  /** Confirm: start the Ranking on these titles, in this order, against this Anchor snapshot. */
  onConfirm: (start: { order: number[]; anchors: AnchorScore[] }) => void
}) {
  const { list, scoreFormat, titleLanguage, mediaType } = props
  const [picked, setPicked] = useState<ReadonlySet<number>>(props.initialPicks)
  const view = useMemo(() => pickerView({ list, scoreFormat, titleLanguage, picked }), [list, scoreFormat, titleLanguage, picked])
  const { summary, confirm } = view

  return (
    <div className="pk">
      <header className="pk-top">
        <button className="pk-back" aria-label="Back to Start" onClick={props.onBack}>
          ←
        </button>
        <h1>Choose titles to score</h1>
      </header>
      <div className="pk-summary" aria-live="polite">
        <span>
          <b>{summary.picked}</b> picked · <b>{summary.anchors}</b> {pluralWord(summary.anchors, 'Anchor')} left on{' '}
          <b>{summary.scores}</b> {pluralWord(summary.scores, 'score')} · about <b>{summary.duels}</b> {pluralWord(summary.duels, 'Duel')}
        </span>
        <span className="grow" />
        <button
          className="go sm"
          disabled={!confirm.allowed}
          onClick={() => confirm.allowed && props.onConfirm({ order: confirm.order, anchors: confirm.anchors })}
        >
          Start Duels →
        </button>
      </div>
      {!confirm.allowed && <div className="pk-reason small">{confirm.reason}</div>}
      <div className="pk-hint small fine">
        {count(view.rows.length, 'title')} on your list, Planning ones left out. A picked title is scored again from scratch
        and is not an Anchor; every other score stays as it is.
      </div>
      <ul className="pk-list">
        {view.rows.map((row) => (
          <li key={row.entry.mediaId}>
            <button
              className={row.picked ? 'pk-row on' : 'pk-row'}
              role="checkbox"
              aria-checked={row.picked}
              onClick={() => setPicked((current) => togglePick(current, row.entry.mediaId))}
            >
              <span className="pk-tick" aria-hidden="true">
                {row.picked ? '✓' : ''}
              </span>
              <span className="grow pk-title">{row.title}</span>
              <span className="pk-meta small">{row.year ?? '—'}</span>
              <span className="pk-meta small">{statusLabel(row.status, mediaType)}</span>
              <span className={row.score ? 'pk-score' : 'pk-score none'}>{row.score ?? 'no score'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
