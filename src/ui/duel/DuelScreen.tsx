import { useEffect, useEffectEvent, useState } from 'react'
import type { ListEntry, MediaType, TitleLanguage } from '../../anilist/types.ts'
import type { BandIndex, Prompt, RankingState, SubBandIndex } from '../../ranking/engine.ts'
import { BAND_UI } from '../bands.ts'
import { EXT_ICON, MOVE_ICON, SAME_ICON, UNDO_ICON } from '../icons.tsx'
import { Kao, SubPill } from '../Kao.tsx'
import { count, metaLine, titleName } from '../meta.ts'
import { MoveSheet } from '../move/MoveSheet.tsx'
import './duel.css'

type DuelPrompt = Extract<Prompt, { kind: 'duel' }>

/** Duels left for this insertion at most: binary search over the remaining lo..hi slots. */
function spotsLeft(bounds: DuelPrompt['bounds']): number {
  return Math.ceil(Math.log2(bounds.hi - bounds.lo + 1))
}

function Card(props: {
  id: number
  side: 'l' | 'r'
  entry: ListEntry | undefined
  titleLanguage: TitleLanguage
  mediaType: MediaType
  onPick: () => void
  onForget: () => void
  /** Opens the Move sheet for this card; undefined = no Move button. */
  onMove?: () => void
  moving: boolean
}) {
  const { id, side, entry, titleLanguage, mediaType, onPick, onForget, onMove, moving } = props
  const name = titleName(entry, id, titleLanguage)
  const backdrop = entry?.bannerUrl ?? entry?.coverUrl ?? null
  const key = side === 'l' ? '←' : '→'
  return (
    <div className="card" onClick={onPick} role="button" tabIndex={-1} aria-label={`Pick ${name}`}>
      <div
        className={backdrop ? 'bg' : 'bg ph'}
        style={backdrop ? { backgroundImage: `url("${backdrop}")` } : { ['--c' as string]: entry?.coverColor ?? undefined }}
      />
      {entry?.coverUrl ? (
        <img className="cv" src={entry.coverUrl} alt="" style={{ background: entry.coverColor ?? undefined }} />
      ) : (
        <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
      )}
      <div className="info">
        <div className="t">{name}</div>
        {entry && <div className="m">{metaLine(entry, mediaType)}</div>}
        <span className="kbd">{key}</span>
      </div>
      <div className={`corner ${side}`} onClick={(e) => e.stopPropagation()}>
        <button className="ibtn tip" data-tip={`Don't remember (F${key})`} aria-label={`Don't remember ${name}`} onClick={onForget}>
          <span className="q">?</span>
        </button>
        {onMove && (
          <button className={moving ? 'ibtn tip on' : 'ibtn tip'} data-tip={`Move Band (M${key})`} aria-label={`Move ${name} to another Band`} onClick={onMove}>
            {MOVE_ICON}
          </button>
        )}
        {entry && (
          <a className="ibtn tip" data-tip="Open on AniList" aria-label={`Open ${name} on AniList`} href={entry.siteUrl} target="_blank" rel="noreferrer">
            {EXT_ICON}
          </a>
        )}
      </div>
    </div>
  )
}

/**
 * Duel = split-bleed (issue #4): two full-height cards, an "about the same" seam button in the middle,
 * Don't remember and AniList on each card's corner, Undo at the bottom.
 * Keys: ← / → pick, ↓ about the same, F then ← / → Don't remember, M then ← / → Move Band, Backspace undo.
 */
export function DuelScreen(props: {
  state: RankingState
  prompt: DuelPrompt
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  mediaType: MediaType
  onPick: (winner: number) => void
  onTie: () => void
  onForget: (id: number) => void
  onUndo: () => void
  /** Opens the Band choice (the Band pill at the top). */
  onChooseBand?: () => void
  /** Move Band from a card (#11): the title leaves this Duel and is placed next in its new (Sub-)band. */
  onMove?: (id: number, band: BandIndex, sub?: SubBandIndex) => void
  /** Shown in front of the pill while a fix is being placed, e.g. "Re-ranking: Frieren". */
  note?: string
}) {
  const { state, prompt, entries, titleLanguage, mediaType, onPick, onTie, onForget, onUndo, onChooseBand, onMove, note } = props
  const [forgetting, setForgetting] = useState(false)
  // `M` waits for ← / →; then the sheet is open for that card.
  const [movePending, setMovePending] = useState(false)
  const [moving, setMoving] = useState<number | null>(null)
  // Inside a split Band the pill counts the current Sub-band only.
  const part = prompt.sub !== undefined ? state.bands[prompt.band].subBands?.[prompt.sub] : undefined
  const progress = part
    ? (() => {
        const placed = part.tiers.reduce((n, tier) => n + tier.length, 0)
        return { done: placed, total: placed + part.unplaced.length }
      })()
    : state.progress.bands[prompt.band]
  const overall = state.progress.ranked

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (moving !== null) return // the Move sheet has the keys
    const side = e.key === 'ArrowLeft' ? prompt.left : e.key === 'ArrowRight' ? prompt.right : null
    if (side !== null) {
      e.preventDefault()
      if (movePending) setMoving(side)
      else if (forgetting) onForget(side)
      else onPick(side)
      setForgetting(false)
      setMovePending(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setForgetting(false)
      onTie()
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      setForgetting(false)
      if (state.canUndo) onUndo()
    } else if (e.key === 'f' || e.key === 'F') {
      setMovePending(false)
      setForgetting((on) => !on)
    } else if ((e.key === 'm' || e.key === 'M') && onMove) {
      setForgetting(false)
      setMovePending((on) => !on)
    } else if (e.key === 'Escape') {
      setForgetting(false)
      setMovePending(false)
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const card = (id: number, side: 'l' | 'r') => (
    <Card
      key={id}
      id={id}
      side={side}
      entry={entries.get(id)}
      titleLanguage={titleLanguage}
      mediaType={mediaType}
      onPick={() => onPick(id)}
      onForget={() => onForget(id)}
      onMove={onMove ? () => setMoving(id) : undefined}
      moving={moving === id}
    />
  )
  const spots = spotsLeft(prompt.bounds)

  return (
    <div className="duel">
      <div className="topline">
        <i style={{ width: `${overall.total ? (overall.done / overall.total) * 100 : 100}%` }} />
      </div>
      <div className="float-info">
        <button className="pill" aria-live="polite" onClick={onChooseBand} disabled={!onChooseBand} title="Choose another Band">
          {note && <>{note} · </>}
          <Kao band={prompt.band} size={10} /> {BAND_UI[prompt.band].label}
          {prompt.sub !== undefined && (
            <>
              {' › '}
              <SubPill sub={prompt.sub} size={10} />
            </>
          )}{' '}
          · {progress.done}/{progress.total} · {count(spots, 'spot')} left
          {forgetting && (
            <>
              {' '}
              · <b>F: pick ← or →</b>
            </>
          )}
          {movePending && (
            <>
              {' '}
              · <b>M: pick ← or →</b>
            </>
          )}
        </button>
      </div>
      <div className="pair">
        {card(prompt.left, 'l')}
        {card(prompt.right, 'r')}
        <button className="seam" onClick={onTie} aria-label="About the same">
          {SAME_ICON}
          <span>Same</span>
          <span className="kbd">↓</span>
        </button>
      </div>
      <div className="float-undo">
        <button className="pill" onClick={onUndo} disabled={!state.canUndo}>
          {UNDO_ICON} Undo <span className="kbd">⌫</span>
        </button>
      </div>
      {moving !== null && onMove && (
        <MoveSheet
          state={state}
          id={moving}
          entries={entries}
          titleLanguage={titleLanguage}
          onClose={() => setMoving(null)}
          onMove={(band, sub) => {
            setMoving(null)
            onMove(moving, band, sub)
          }}
        />
      )}
    </div>
  )
}
