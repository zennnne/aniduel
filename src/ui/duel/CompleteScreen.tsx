import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, type RankingState } from '../../ranking/engine.ts'
import { UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import './duel.css'
import { titleName } from '../meta.ts'

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
  // Place of each Band's first Tier in the whole Ranking (a Tier is one place).
  const firstPlace = BANDS.map((band) => state.bands.slice(0, band).reduce((sum, b) => sum + b.tiers.length, 1))
  return (
    <div className="ranked">
      <div className="h1">Every Band is ranked</div>
      <div className="sub">
        {state.progress.ranked.done} titles in your Ranking
        {state.forgotten.length > 0 && ` · ${state.forgotten.length} Forgotten`}
      </div>
      {BANDS.filter((band) => state.bands[band].tiers.length > 0).map((band) => (
        <section key={band} className="res">
          <Kao band={band} size={14} />
          {state.bands[band].tiers.map((tier, i) => (
            <div key={tier[0]} className="ln">
              <b>{firstPlace[band] + i}</b>
              <span>
                {tier.map(name).join(' = ')}
                {tier.length > 1 && <span className="tie"> Tier · same score</span>}
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
