import { useEffect, useEffectEvent } from 'react'
import type { ListEntry, MediaType, TitleLanguage } from '../../anilist/types.ts'
import { displayTitle } from '../../pool/pool.ts'
import { BANDS, type BandIndex, type RankingState } from '../../ranking/engine.ts'
import { BAND_UI } from '../bands.ts'
import { Kao } from '../Kao.tsx'
import './roughsort.css'

const UNDO_ICON = (
  <svg className="li" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
)
const EXT_ICON = (
  <svg className="li" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
)

/** "2016 · TV · 12 eps": year · format, plus the length unless it is a movie or unknown. */
function metaLine(entry: ListEntry, mediaType: MediaType): string {
  const parts: string[] = []
  if (entry.year) parts.push(String(entry.year))
  if (entry.format) parts.push(entry.format.replace(/_/g, ' '))
  if (entry.length && entry.format !== 'MOVIE') parts.push(`${entry.length} ${mediaType === 'MANGA' ? 'ch' : 'eps'}`)
  return parts.join(' · ')
}

/**
 * Rough Sort = "Ladder" (issue #4): the title on the left, five Band buttons on the right
 * (Loved on top), with Don't remember / Undo / AniList underneath. Keys 1-5, 0, Backspace.
 */
export function RoughSortScreen(props: {
  state: RankingState
  /** Display data by media id. A title missing from it still works, with a plain card. */
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  mediaType: MediaType
  onBand: (band: BandIndex) => void
  onForget: () => void
  onUndo: () => void
}) {
  const { state, entries, titleLanguage, mediaType, onBand, onForget, onUndo } = props
  const { done, total } = state.progress.roughSort
  const prompt = state.prompt.kind === 'rough-sort' ? state.prompt : null

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (state.canUndo) onUndo()
      return
    }
    if (!prompt) return
    if (e.key >= '1' && e.key <= '5') onBand((Number(e.key) - 1) as BandIndex)
    else if (e.key === '0') onForget()
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const entry = prompt ? entries.get(prompt.id) : undefined
  const name = entry ? displayTitle(entry.title, titleLanguage) : prompt ? `Title #${prompt.id}` : ''
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
      {prompt ? (
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
      ) : (
        <div className="rs-done">
          <div className="t">Rough Sort done</div>
          <div className="m">
            Every title has a Band. Duels inside each Band come next.
          </div>
          <div className="bands-summary">
            {BANDS.map((band) => (
              <span key={band} className="row">
                <Kao band={band} size={14} /> {state.bands[band].titles.length}
              </span>
            ))}
          </div>
          <button className="pill" onClick={onUndo} disabled={!state.canUndo}>
            {UNDO_ICON} Undo last answer <span className="kbd">⌫</span>
          </button>
        </div>
      )}
    </div>
  )
}
