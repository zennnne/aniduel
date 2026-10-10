import { useEffect, useEffectEvent } from 'react'
import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import type { Prompt, RankingState } from '../../ranking/engine.ts'
import { formatLevel } from '../../ranking/scoring.ts'
import { UNDO_ICON } from '../icons.tsx'
import { titleName } from '../meta.ts'
import './duel.css'

type CloserToPrompt = Extract<Prompt, { kind: 'closer-to' }>

/** Anchors shown per score: their covers and names. */
const SHOWN = 3

function Cover({ entry }: { entry: ListEntry | undefined }) {
  return entry?.coverUrl ? (
    <img className="cv" src={entry.coverUrl} alt="" style={{ background: entry.coverColor ?? undefined }} />
  ) : (
    <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
  )
}

/**
 * The closer-to prompt (GLOSSARY, #48): full screen over the Duel, the new title's cover and two columns, one per
 * score it sits between, each with a few of that score's Anchors (never Forgotten or Suspect ones).
 * Keys: ← the upper score, → the lower one, Backspace undo.
 */
export function CloserToScreen(props: {
  state: RankingState
  prompt: CloserToPrompt
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  onPick: (level: number) => void
  onUndo: () => void
}) {
  const { state, prompt, entries, titleLanguage, onPick, onUndo } = props
  const newTitles = state.newTitles!
  const name = (id: number) => titleName(entries.get(id), id, titleLanguage)
  const unused = new Set([...state.forgotten, ...newTitles.suspect.map((s) => s.id)])
  const { done, total } = state.progress.ranked

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      onPick(e.key === 'ArrowLeft' ? prompt.upper : prompt.lower)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (state.canUndo) onUndo()
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const column = (level: number, key: string) => {
    const anchors = (newTitles.levels.find((l) => l.level === level)?.anchors ?? []).filter((id) => !unused.has(id))
    const shown = anchors.slice(0, SHOWN)
    const more = anchors.length - shown.length
    const label = formatLevel(newTitles.format, level)
    return (
      <button className="col" onClick={() => onPick(level)} aria-label={`Closer to ${label}`}>
        <span className="n">{label}</span>
        <span className="exs">
          {shown.map((id) => (
            <Cover key={id} entry={entries.get(id)} />
          ))}
        </span>
        <span className="small">
          {shown.map(name).join(' · ')}
          {more > 0 && ` · ${more} more`}
        </span>
        <span className="kbd">{key}</span>
      </button>
    )
  }

  return (
    <div className="duel">
      <div className="topline">
        <i style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
      </div>
      <div className="closer">
        <Cover entry={entries.get(prompt.id)} />
        <div className="fh">{name(prompt.id)} sits between two of your scores</div>
        <div>Which is it closer to?</div>
        <div className="cols">
          {column(prompt.upper, '←')}
          {column(prompt.lower, '→')}
        </div>
        <button className="pill" onClick={onUndo} disabled={!state.canUndo}>
          {UNDO_ICON} Undo <span className="kbd">⌫</span>
        </button>
      </div>
    </div>
  )
}
