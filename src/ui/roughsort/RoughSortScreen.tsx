import { useEffect, useEffectEvent, useState } from 'react'
import type { ListEntry, MediaType, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, SUB_BANDS, type BandIndex, type RankingState, type SubBandIndex } from '../../ranking/engine.ts'
import { BAND_UI, SUB_BAND_UI } from '../bands.ts'
import { EXT_ICON, UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import { metaLine, titleName } from '../meta.ts'
import './roughsort.css'

/**
 * Rough Sort = "Ladder" (issue #4): the title on the left, five Band buttons on the right
 * (Loved on top), with Don't remember / Undo / AniList underneath. Keys 1-5, 0, Backspace.
 * A split Band opens a second tap under its button: Best / Middle / Lowest (Q / W / E; Esc or Backspace goes back).
 * Under them, the Board pill (key B) opens the Board.
 */
export function RoughSortScreen(props: {
  state: RankingState
  /** The title the engine prompts now. */
  id: number
  /** Display data by media id. A title missing from it still works, with a plain card. */
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  mediaType: MediaType
  /** `sub` is set when the Band is split: the second tap (ADR 0006). */
  onBand: (band: BandIndex, sub?: SubBandIndex) => void
  onForget: () => void
  onUndo: () => void
  /** Opens the Board; left out while the Board is closed. */
  onBoard?: () => void
}) {
  const { state, id, entries, titleLanguage, mediaType, onBand, onForget, onUndo, onBoard } = props
  const { done, total } = state.progress.roughSort
  // A split Band needs a second tap to pick its Sub-band; it never defaults to Middle (ADR 0006).
  const [pending, setPending] = useState<BandIndex | null>(null)

  function pickBand(band: BandIndex) {
    if (state.bands[band].subBands) setPending(band)
    else onBand(band)
  }

  function pickSub(sub: SubBandIndex) {
    if (pending === null) return
    setPending(null)
    onBand(pending, sub)
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (pending !== null) {
      const sub = SUB_BANDS.find((s) => SUB_BAND_UI[s].key === e.key.toUpperCase())
      if (sub !== undefined) pickSub(sub)
      else if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault()
        setPending(null)
      } else if (e.key >= '1' && e.key <= '5') pickBand((Number(e.key) - 1) as BandIndex)
      return
    }
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (state.canUndo) onUndo()
      return
    }
    if (e.key >= '1' && e.key <= '5') pickBand((Number(e.key) - 1) as BandIndex)
    else if (e.key === '0') onForget()
    else if (e.key.toLowerCase() === 'b' && onBoard) onBoard()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const entry = entries.get(id)
  const name = titleName(entry, id, titleLanguage)
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
              <div key={band} className="bandslot">
                <button
                  className={pending === band ? 'bandbtn picked' : 'bandbtn'}
                  onClick={() => (pending === band ? setPending(null) : pickBand(band))}
                  aria-expanded={state.bands[band].subBands ? pending === band : undefined}
                >
                  <span className="row">
                    <span className="kbd">{band + 1}</span>
                    <Kao band={band} size={17} />
                  </span>
                  <span className="lab">
                    {BAND_UI[band].label}
                    {state.bands[band].subBands && pending !== band && <span className="fine"> · 3 Sub-bands</span>}
                  </span>
                </button>
                {pending === band && (
                  <div className="subtap" role="group" aria-label={`${BAND_UI[band].label}: which Sub-band?`}>
                    {SUB_BANDS.map((sub) => (
                      <button key={sub} style={{ background: SUB_BAND_UI[sub].colour }} onClick={() => pickSub(sub)} autoFocus={sub === 0}>
                        {SUB_BAND_UI[sub].label}
                        <span className="kbd">{SUB_BAND_UI[sub].key}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
          {onBoard && (
            <div className="rs-boardrow">
              <button className="pill hl" onClick={onBoard}>
                ▦ Board <span className="kbd">B</span>
              </button>
              <span className="cap">See every title you've sorted, by Band. Fix one without Undo.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
