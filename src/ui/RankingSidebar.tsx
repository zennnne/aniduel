import type { ReactNode } from 'react'
import type { ListEntry, MediaType, TitleLanguage, Viewer } from '../anilist/types.ts'
import { BANDS, SUB_BANDS, type BandIndex, type RankingState } from '../ranking/engine.ts'
import { SUB_BAND_UI } from './bands.ts'
import { Kao } from './Kao.tsx'
import { MEDIA_LABEL, count, titleName } from './meta.ts'

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
  menu?: ReactNode
  /** Bands offered a split right now: their bar is outlined in red. */
  offered?: readonly BandIndex[]
}) {
  const { viewer, mediaType, state, entries, titleLanguage, menu, offered } = props
  const prompt = state.prompt
  const duel = prompt.kind === 'duel' ? prompt : null
  const roughSorting = prompt.kind === 'rough-sort'
  const { done, total } = roughSorting ? state.progress.roughSort : state.progress.ranked
  const name = (id: number) => titleName(entries.get(id), id, titleLanguage)
  return (
    <>
      <div className="logo">
        Ani<b>Duel!</b>
      </div>
      <div className="small hide-m">
        {viewer.name} · {MEDIA_LABEL[mediaType]} · {count(state.progress.roughSort.total, 'title')}
      </div>
      <div className="col hide-m" style={{ gap: 4 }}>
        {BANDS.map((band) => {
          const p = state.progress.bands[band]
          // During Rough Sort the bar shows each Band's share so far; afterwards, how much of it is placed.
          const share = roughSorting ? (done ? p.total / done : 0) : p.total ? p.done / p.total : 0
          const subBands = state.bands[band].subBands
          return (
            <div key={band} className={duel?.band === band && !state.bandChoice ? 'bandrow cur' : 'bandrow'}>
              <Kao band={band} size={10} />
              {subBands ? (
                // A split Band stays one row; its bar is striped by Sub-band (width = titles in it, fill = placed).
                <div className="bar segs" title="Best / Middle / Lowest">
                  {SUB_BANDS.map((sub) => {
                    const placed = subBands[sub].tiers.reduce((n, t) => n + t.length, 0)
                    const all = placed + subBands[sub].unplaced.length
                    const fill = roughSorting || all === 0 ? 100 : (placed / all) * 100
                    return (
                      <span key={sub} style={{ flex: all, ['--sub' as string]: SUB_BAND_UI[sub].colour }}>
                        <i style={{ width: `${fill}%` }} />
                      </span>
                    )
                  })}
                </div>
              ) : (
                <div className={offered?.includes(band) ? 'bar over' : 'bar'}>
                  <i style={{ width: `${share * 100}%` }} />
                </div>
              )}
              <span>{roughSorting ? p.total : `${p.done}/${p.total}`}</span>
            </div>
          )
        })}
        {!roughSorting && (
          <div className="bandrow total">
            <span>Total</span>
            <div className="bar">
              <i style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
            </div>
            <span>
              {done}/{total}
            </span>
          </div>
        )}
      </div>
      {duel && !state.bandChoice && (
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
      {menu}
    </>
  )
}
