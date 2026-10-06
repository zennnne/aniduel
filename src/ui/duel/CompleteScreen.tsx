import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, type RankingState } from '../../ranking/engine.ts'
import { UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import './duel.css'
import { titleName } from '../meta.ts'
import { rankingLines } from '../rankingLines.ts'

/** Shown once every Band is ranked: the whole Ranking, Bands → Tiers → titles, and the way on to Preview. */
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
  const bands = BANDS.map((band) => ({ band, lines: rankingLines(state, band) })).filter(({ lines }) => lines.length > 0)
  return (
    <div className="ranked">
      <div className="h1">Every Band is ranked</div>
      <div className="sub">
        {state.progress.ranked.done} titles in your Ranking
        {state.forgotten.length > 0 && ` · ${state.forgotten.length} Forgotten`}
      </div>
      {bands.map(({ band, lines }) => (
        <section key={band} className="res">
          <Kao band={band} size={14} />
          {lines.map((line) => (
            <div key={line.key} className="ln">
              <b>{line.mark}</b>
              <span>
                {line.ids.map(name).join(state.standing ? ', ' : ' = ')}
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
