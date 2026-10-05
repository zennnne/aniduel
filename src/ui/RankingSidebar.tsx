import type { ReactNode } from 'react'
import type { MediaType, Viewer } from '../anilist/types.ts'
import { BANDS, type RankingState } from '../ranking/engine.ts'
import { Kao } from './Kao.tsx'

/**
 * Sidebar of the "Cockpit" Shell (issue #4): logo, who and what is being ranked, and one row per Band.
 * During Rough Sort each row shows how many titles the Band holds so far.
 */
export function RankingSidebar(props: { viewer: Viewer; mediaType: MediaType; state: RankingState; menu?: ReactNode }) {
  const { viewer, mediaType, state, menu } = props
  const { done, total } = state.progress.roughSort
  return (
    <>
      <div className="logo">
        Ani<b>Duel!</b>
      </div>
      <div className="small hide-m">
        {viewer.name} · {mediaType === 'ANIME' ? 'Anime' : 'Manga'} · {total} titles
      </div>
      <div className="col hide-m" style={{ gap: 4 }}>
        {BANDS.map((band) => {
          const size = state.bands[band].titles.length
          return (
            <div key={band} className="bandrow">
              <Kao band={band} size={10} />
              <div className="bar">
                <i style={{ width: `${done ? (size / done) * 100 : 0}%` }} />
              </div>
              <span>{size}</span>
            </div>
          )
        })}
      </div>
      <div className="small hide-m">
        {state.forgotten.length > 0 && `${state.forgotten.length} Forgotten`}
      </div>
      <span className="grow" />
      <span className="small">
        {done}/{total}
      </span>
      {menu}
    </>
  )
}
