import type { ListEntry, MediaType, TitleLanguage, Viewer } from '../anilist/types.ts'
import { displayTitle } from '../pool/pool.ts'
import { BANDS, type RankingState } from '../ranking/engine.ts'
import { Kao } from './Kao.tsx'

/**
 * Sidebar of the "Cockpit" Shell (issue #4): logo, who and what is being ranked, one row per Band
 * (placed / titles in the Band), and during a Duel the current Band's Ranking so far, with the
 * insertion bounds (inb) and the pivot (piv) highlighted.
 */
export function RankingSidebar(props: {
  viewer: Viewer
  mediaType: MediaType
  state: RankingState
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
}) {
  const { viewer, mediaType, state, entries, titleLanguage } = props
  const prompt = state.prompt
  const duel = prompt.kind === 'duel' ? prompt : null
  const roughSorting = prompt.kind === 'rough-sort'
  const { done, total } = roughSorting ? state.progress.roughSort : state.progress.ranked
  const name = (id: number) => {
    const entry = entries.get(id)
    return entry ? displayTitle(entry.title, titleLanguage) : `#${id}`
  }
  return (
    <>
      <div className="logo">
        Ani<b>Duel!</b>
      </div>
      <div className="small hide-m">
        {viewer.name} · {mediaType === 'ANIME' ? 'Anime' : 'Manga'} · {state.progress.roughSort.total} titles
      </div>
      <div className="col hide-m" style={{ gap: 4 }}>
        {BANDS.map((band) => {
          const p = state.progress.bands[band]
          // During Rough Sort the bar shows each Band's share so far; afterwards, how much of it is placed.
          const share = roughSorting ? (done ? p.total / done : 0) : p.total ? p.done / p.total : 0
          return (
            <div key={band} className={duel?.band === band ? 'bandrow cur' : 'bandrow'}>
              <Kao band={band} size={10} />
              <div className="bar">
                <i style={{ width: `${share * 100}%` }} />
              </div>
              <span>{roughSorting ? p.total : `${p.done}/${p.total}`}</span>
            </div>
          )
        })}
      </div>
      {duel && (
        <>
          <div className="small row hide-m">
            <Kao band={duel.band} size={10} /> Ranking so far
          </div>
          <div className="rank hide-m">
            {state.bands[duel.band].tiers.map((tier, i) => {
              const { lo, hi, pivot } = duel.bounds
              const cls = i === pivot ? 'piv' : i >= lo && i < hi ? 'inb' : 'out'
              return (
                <div key={tier[0]} className={cls}>
                  {i + 1}. {tier.map(name).join(' = ')}
                </div>
              )
            })}
          </div>
        </>
      )}
      <div className="small hide-m">{state.forgotten.length > 0 && `${state.forgotten.length} Forgotten`}</div>
      <span className="grow" />
      <span className="small">
        {done}/{total}
      </span>
    </>
  )
}
