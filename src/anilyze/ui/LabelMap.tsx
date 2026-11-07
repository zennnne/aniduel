// The label map (#89): picture bubbles on hit rate × flop rate, the four labels as its corners, overlapping bubbles of
// one label stacked under a "+N" that fans them out. On a phone, four label tiles instead; a tile zooms into its corner.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Label } from '../scoring.ts'
import { countOf, type ToolWords } from '../tool.ts'
import { useWidth } from './useWidth.ts'
import { cornerMap, labelMap, type LabelLines, type MapBubble } from './labelMap.ts'
import { CORNERS, LABELS, signed } from './labels.ts'
import type { Picture } from './Picture.tsx'
import type { RankCard } from './resultView.ts'

/** The tool's wording and its picture for each card. */
type Look = { words: ToolWords; Picture: Picture }

type MapProps = Look & { cards: RankCard[]; lines: LabelLines; openId: number; onOpen: (id: number) => void }

/** The map's height for its width (the prototype's 1 : 0.78). */
const ASPECT = 0.78
/** Cards at or above this rank always show their name on the map. */
const NAMED = 5

const rankText = (card: RankCard) => (card.rank === null ? '🌱' : String(card.rank))
const describe = (card: RankCard) =>
  `${card.rank === null ? 'Watchlist' : `#${card.rank}`} ${card.name}, ${LABELS[card.label].name}, ${card.hearts} of 5 hearts`

type PinProps = Look & {
  card: RankCard
  x: number
  y: number
  r: number
  open: boolean
  /** The name tag under the bubble, if any. */
  name: string | null
  onOpen: (id: number) => void
  className?: string
  autoFocus?: boolean
  /** The stack this pin stands for, by its top card's id (the pin's own card when not given). */
  stack?: number
  children?: ReactNode
}

function Pin({ words, Picture, card, x, y, r, open, name, onOpen, className, autoFocus, stack, children }: PinProps) {
  const style: CSSProperties = { left: x, top: y, width: r * 2, height: r * 2 }
  return (
    <div className={`st-pin ${className ?? ''}`} style={style} data-stack={stack ?? card.id}>
      <button
        type="button"
        className={`st-bub${open ? ' on' : ''}${card.rank === null ? ' wl' : ''}`}
        style={{ background: card.coverColor ?? undefined }}
        aria-label={describe(card)}
        aria-pressed={open}
        title={`${card.name} · ${words.score} ${signed(card.score)}`}
        autoFocus={autoFocus}
        onClick={() => onOpen(card.id)}
      >
        <Picture card={card} place="bubble" />
        <span className="rb" aria-hidden="true">
          {rankText(card)}
        </span>
      </button>
      {name && (
        <span className="nmtag" aria-hidden="true">
          {name}
        </span>
      )}
      {children}
    </div>
  )
}

function Corners() {
  return (
    <>
      {CORNERS.map((label) => (
        <div key={label} className={`st-q ${label}`} aria-hidden="true">
          <b>
            {LABELS[label].icon} {LABELS[label].name}
          </b>
          <span>{LABELS[label].meaning}</span>
        </div>
      ))}
    </>
  )
}

/** The desktop map. */
export function LabelMap({ words, Picture, cards, lines, openId, onOpen }: MapProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = Math.round(width * ASPECT)
  const bubbles = useMemo(() => (width ? labelMap(cards, lines, { width, height }) : []), [cards, lines, width, height])
  // The stack fanned out, by its top card's id.
  const [fan, setFan] = useState<number | null>(null)
  const fanned = bubbles.find((b) => b.members.length > 1 && b.members[0].id === fan)

  useEffect(() => {
    if (fan === null) return
    const map = ref.current
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFan(null)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // Folded back: focus returns to the stack, so the keyboard doesn't lose its place.
      map?.querySelector<HTMLElement>(`[data-stack="${fan}"] .st-bub`)?.focus()
    }
  }, [fan, ref])

  const open = (id: number) => {
    setFan(null)
    onOpen(id)
  }

  return (
    <div className="st-map card" ref={ref} style={{ height: height || undefined }} role="group" aria-label="Label map: hit rate up, flop rate across">
      <Corners />
      {bubbles.map((b) => (b === fanned ? null : <StackPin key={b.members[0].id} words={words} Picture={Picture} bubble={b} openId={openId} onOpen={open} onFan={setFan} />))}
      {fanned && <Fan words={words} Picture={Picture} bubble={fanned} box={{ width, height }} openId={openId} onOpen={open} onClose={() => setFan(null)} />}
      <span className="st-maphint" aria-hidden="true">
        Tap a “+N” to fan out a stack
      </span>
    </div>
  )
}

function StackPin({ words, Picture, bubble, openId, onOpen, onFan }: Look & { bubble: MapBubble; openId: number; onOpen: (id: number) => void; onFan: (id: number) => void }) {
  const top = bubble.members[0]
  // A stack holding the open card shows that card on its face, with the ring and its name.
  const openMember = bubble.members.find((m) => m.id === openId)
  const face = openMember ?? top
  const rest = bubble.members.filter((m) => m !== face)
  const name = openMember || (top.rank !== null && top.rank <= NAMED) ? face.name : null
  return (
    <Pin words={words} Picture={Picture} card={face} x={bubble.x} y={bubble.y} r={bubble.r} open={Boolean(openMember)} name={name} onOpen={onOpen} stack={top.id}>
      {rest.length > 0 && (
        <button
          type="button"
          className="more"
          aria-label={`${rest.length} more ${countOf(words, rest.length)} here: ${rest.map((m) => m.name).join(', ')}`}
          aria-expanded={false}
          onClick={() => onFan(top.id)}
        >
          +{rest.length}
        </button>
      )}
    </Pin>
  )
}

/** A stack fanned out in a ring around where it sat; Escape or a click outside folds it back. */
function Fan({ words, Picture, bubble, box, openId, onOpen, onClose }: Look & { bubble: MapBubble; box: { width: number; height: number }; openId: number; onOpen: (id: number) => void; onClose: () => void }) {
  const n = bubble.members.length
  const r = Math.max(bubble.r, 22)
  const ring = Math.max(r * 2 + 34, n * 20)
  return (
    <>
      <div className="st-fanscrim" onClick={onClose} aria-hidden="true" />
      {bubble.members.map((card, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n
        const x = Math.min(box.width - r, Math.max(r, bubble.x + (i ? Math.cos(angle) * ring : 0)))
        const y = Math.min(box.height - r, Math.max(r, bubble.y + (i ? Math.sin(angle) * ring : 0)))
        return <Pin key={card.id} words={words} Picture={Picture} card={card} x={x} y={y} r={r} open={card.id === openId} name={card.name} onOpen={onOpen} className="fanned" autoFocus={i === 0} />
      })}
    </>
  )
}

type TilesProps = MapProps & { zoom: Label | null; onZoom: (label: Label | null) => void }

/** The phone's map: four label tiles, or one corner zoomed to the whole box. */
export function LabelTiles({ words, Picture, cards, lines, openId, onOpen, zoom, onZoom }: TilesProps) {
  if (zoom) return <ZoomedCorner words={words} Picture={Picture} cards={cards} lines={lines} openId={openId} onOpen={onOpen} label={zoom} onBack={() => onZoom(null)} />
  return (
    <div className="st-tiles">
      {CORNERS.map((label) => {
        const mine = cards.filter((c) => c.label === label).sort((a, b) => b.score - a.score)
        return (
          <button key={label} type="button" className={`st-tile ${label}`} onClick={() => onZoom(label)} disabled={!mine.length}>
            <b>
              <span aria-hidden="true">{LABELS[label].icon}</span> {LABELS[label].name}
            </b>
            <span className="d">{LABELS[label].meaning}</span>
            <span className="st" aria-hidden="true">
              {mine.slice(0, 4).map((c) => (
                <Picture key={c.id} card={c} place="tile" />
              ))}
              {mine.length > 4 && <em>+{mine.length - 4}</em>}
            </span>
            <span className="c">
              {mine.length} {countOf(words, mine.length)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ZoomedCorner({ words, Picture, cards, lines, openId, onOpen, label, onBack }: MapProps & { label: Label; onBack: () => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = Math.round(width * 0.92)
  const bubbles = useMemo(() => (width ? cornerMap(cards, label, lines, { width, height }) : []), [cards, label, lines, width, height])
  return (
    <div className={`st-map st-zoom card ${label}`} ref={ref} style={{ height: height || undefined }} role="group" aria-label={`${LABELS[label].name} ${words.many}`}>
      <button type="button" className="st-qback" onClick={onBack}>
        ← all labels
      </button>
      <div className="st-qtitle" aria-hidden="true">
        {LABELS[label].icon} {LABELS[label].name}
        <span>{LABELS[label].meaning}</span>
      </div>
      {bubbles.map(({ members: [card], x, y, r }) => (
        <Pin
          key={card.id}
          words={words}
          Picture={Picture}
          card={card}
          x={x}
          y={y}
          r={r}
          open={card.id === openId}
          name={(card.rank !== null && card.rank <= 10) || card.id === openId ? card.name : null}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}
