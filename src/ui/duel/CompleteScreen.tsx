import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, type RankingState } from '../../ranking/engine.ts'
import { isScores } from '../../ranking/sortGoal.ts'
import { UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import './duel.css'
import { titleName } from '../meta.ts'
import { newTitlesLines, rankingLines } from '../rankingLines.ts'

/**
 * Shown once every Band is ranked: the whole Ranking, Bands → Tiers → titles, and the way on to Preview. Under Score
 * New Titles (ADR 0009): every new title by score, sorted by name.
 */
export function CompleteScreen(props: {
  state: RankingState
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  onUndo: () => void
  /** Goes on to scoring and Preview; undefined while it can't (e.g. waiting for AniList). */
  onScore?: () => void
}) {
  const { state, entries, titleLanguage, onUndo, onScore } = props
  const name = (id: number) => titleName(entries.get(id), id, titleLanguage)
  if (state.newTitles) return <NewTitlesComplete {...props} name={name} />
  const bands = BANDS.map((band) => ({ band, lines: rankingLines(state, band, name) })).filter(({ lines }) => lines.length > 0)
  // Scores (#25): each line is a score level, its titles sorted by name and joined by " · ", since they have no order.
  const scores = isScores(state)
  return (
    <div className="ranked">
      <div className="h1">{scores ? 'Every score is settled' : 'Every Band is ranked'}</div>
      <div className="sub">
        {state.progress.ranked.done} titles in your Ranking
        {state.forgotten.length > 0 && ` · ${state.forgotten.length} Forgotten`}
        {scores && ' · titles on the same score have no order among themselves'}
      </div>
      {bands.map(({ band, lines }) => (
        <section key={band} className="res">
          <Kao band={band} size={14} />
          {lines.map((line) => (
            <div key={line.key} className="ln">
              <b>{line.mark}</b>
              <span>
                {line.ids.map(name).join(scores ? ' · ' : ' = ')}
                {line.note && <span className="tie"> {line.note}</span>}
              </span>
            </div>
          ))}
        </section>
      ))}
      <div className="row">
        <button className="go" onClick={onScore} disabled={!onScore}>
          Score my Ranking →
        </button>
        <button className="go sm" onClick={onUndo} disabled={!state.canUndo}>
          {UNDO_ICON} Undo last answer
        </button>
      </div>
    </div>
  )
}

/**
 * Score New Titles (ADR 0009): "Every new title has a score", the scores with their new titles, and on to Preview.
 * Titles left with no Anchor to compare (every one Forgotten or Suspect) are never given a score: counted here,
 * listed on Preview's unsettled card.
 */
function NewTitlesComplete(props: { state: RankingState; name: (id: number) => string; onUndo: () => void; onScore?: () => void }) {
  const { state, name, onUndo, onScore } = props
  const lines = newTitlesLines(state, name).filter((line) => line.ids.length > 0)
  const { done, total } = state.progress.ranked
  return (
    <div className="ranked">
      <div className="h1">{done === total ? 'Every new title has a score' : 'No more Duels to ask'}</div>
      <div className="sub">
        {done} new titles scored
        {done < total && ` · ${total - done} not settled: no Anchor left to compare`}
        {state.forgotten.length > 0 && ` · ${state.forgotten.length} Forgotten`} · titles on the same score have no order
        among themselves
      </div>
      <section className="res">
        {lines.map((line) => (
          <div key={line.level} className="ln">
            <b>{line.mark}</b>
            <span>{line.ids.map(name).join(' · ')}</span>
          </div>
        ))}
      </section>
      <div className="row">
        <button className="go" onClick={onScore} disabled={!onScore}>
          Preview my scores →
        </button>
        <button className="go sm" onClick={onUndo} disabled={!state.canUndo}>
          {UNDO_ICON} Undo last answer
        </button>
      </div>
    </div>
  )
}
