import { useEffect, useEffectEvent } from 'react'
import type { ListEntry, MediaType, TitleLanguage } from '../../anilist/types.ts'
import { displayTitle } from '../../pool/pool.ts'
import { BANDS, type BandIndex, type RankingState } from '../../ranking/engine.ts'
import { BAND_UI } from '../bands.ts'
import { EXT_ICON, UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import { metaLine } from '../meta.ts'
import './roughsort.css'

/**
 * Rough Sort = "Ladder" (issue #4): the title on the left, five Band buttons on the right
 * (Loved on top), with Don't remember / Undo / AniList underneath. Keys 1-5, 0, Backspace.
 */
export function RoughSortScreen(props: {
  state: RankingState
  /** The title the engine prompts now. */
  id: number
  /** Display data by media id. A title missing from it still works, with a plain card. */
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  mediaType: MediaType
  onBand: (band: BandIndex) => void
  onForget: () => void
  onUndo: () => void
}) {
  const { state, id, entries, titleLanguage, mediaType, onBand, onForget, onUndo } = props
  const { done, total } = state.progress.roughSort

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (state.canUndo) onUndo()
      return
    }
    if (e.key >= '1' && e.key <= '5') onBand((Number(e.key) - 1) as BandIndex)
    else if (e.key === '0') onForget()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const entry = entries.get(id)
  const name = entry ? displayTitle(entry.title, titleLanguage) : `Title #${id}`
  const backdrop = entry?.bannerUrl ?? entry?.coverUrl ?? null
  const percent = total ? (done / total) * 100 : 100

  return (
    <div className="rs">
      <div className="topline">
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="float-info">
        <span className="pill" aria-live="polite">
          Rough Sort · {done}/{total}
        </span>
      </div>
      <div
        className={backdrop ? 'bg' : 'bg ph'}
        style={backdrop ? { backgroundImage: `url("${backdrop}")` } : { ['--c' as string]: entry?.coverColor ?? undefined }}
      />
      <div className="rs-ladder">
        <div className="left">
          {entry?.coverUrl ? (
            <img className="cv" src={entry.coverUrl} alt="" style={{ background: entry.coverColor ?? undefined }} />
          ) : (
            <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
          )}
          <div className="t">{name}</div>
          {entry && <div className="m">{metaLine(entry, mediaType)}</div>}
        </div>
        <div className="col">
          <div className="bands" role="group" aria-label="Band">
            {BANDS.map((band) => (
              <button key={band} className="bandbtn" onClick={() => onBand(band)}>
                <span className="row">
                  <span className="kbd">{band + 1}</span>
                  <Kao band={band} size={17} />
                </span>
                <span className="lab">{BAND_UI[band].label}</span>
              </button>
            ))}
          </div>
          <div className="subrow">
            <button className="pill" onClick={onForget}>
              <span className="q">?</span> Don't remember <span className="kbd">0</span>
            </button>
            <button className="pill" onClick={onUndo} disabled={!state.canUndo}>
              {UNDO_ICON} Undo <span className="kbd">⌫</span>
            </button>
            {entry && (
              <a className="pill" href={entry.siteUrl} target="_blank" rel="noreferrer">
                {EXT_ICON} AniList
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
