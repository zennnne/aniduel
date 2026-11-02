// The label map (#89): cover bubbles on hit rate × flop rate, the four labels as its corners, overlapping bubbles of
// one label stacked under a "+N" that fans them out. On a phone, four label tiles instead; a tile zooms into its corner.
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { StudioLabel } from '../loadTopStudios.ts'
import { useWidth } from './Bits.tsx'
import { cornerMap, labelMap, type LabelLines, type MapBubble } from './labelMap.ts'
import { CORNERS, LABELS, signed } from './labels.ts'
import type { StudioCard } from './resultView.ts'

type MapProps = { cards: StudioCard[]; lines: LabelLines; openId: number; onOpen: (id: number) => void }

/** The map's height for its width (the prototype's 1 : 0.78). */
const ASPECT = 0.78
/** Studios at or above this rank always show their name on the map. */
const NAMED = 5

const rankText = (card: StudioCard) => (card.rank === null ? '🌱' : String(card.rank))
const describe = (card: StudioCard) =>
  `${card.rank === null ? 'Watchlist' : `#${card.rank}`} ${card.name}, ${LABELS[card.label].name}, ${card.hearts} of 5 hearts`

type PinProps = {
  card: StudioCard
  x: number
  y: number
  r: number
  open: boolean
  /** The name tag under the bubble, if any. */
  name: string | null
  onOpen: (id: number) => void
  className?: string
  autoFocus?: boolean
  children?: ReactNode
}

function Pin({ card, x, y, r, open, name, onOpen, className, autoFocus, children }: PinProps) {
  const style: CSSProperties = { left: x, top: y, width: r * 2, height: r * 2 }
  return (
    <div className={`st-pin ${className ?? ''}`} style={style}>
      <button
        type="button"
        className={`st-bub${open ? ' on' : ''}${card.rank === null ? ' wl' : ''}`}
        style={{ background: card.coverColor ?? undefined }}
        aria-label={describe(card)}
        aria-pressed={open}
        title={`${card.name} · Studio Score ${signed(card.score)}`}
        autoFocus={autoFocus}
        onClick={() => onOpen(card.id)}
      >
        {card.cover && <img src={card.cover} alt="" loading="lazy" />}
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
export function LabelMap({ cards, lines, openId, onOpen }: MapProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = Math.round(width * ASPECT)
  const bubbles = useMemo(() => (width ? labelMap(cards, lines, { width, height }) : []), [cards, lines, width, height])
  // The stack fanned out, by its top studio's id.
  const [fan, setFan] = useState<number | null>(null)
  const fanned = bubbles.find((b) => b.members.length > 1 && b.members[0].id === fan)

  useEffect(() => {
    if (fan === null) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFan(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fan])

  const open = (id: number) => {
    setFan(null)
    onOpen(id)
  }

  return (
    <div className="st-map card" ref={ref} style={{ height: height || undefined }} role="group" aria-label="Label map: hit rate up, flop rate across">
      <Corners />
      {bubbles.map((b) => (b === fanned ? null : <StackPin key={b.members[0].id} bubble={b} openId={openId} onOpen={open} onFan={setFan} />))}
      {fanned && <Fan bubble={fanned} box={{ width, height }} openId={openId} onOpen={open} onClose={() => setFan(null)} />}
      <span className="st-maphint" aria-hidden="true">
        Tap a “+N” to fan out a stack
      </span>
    </div>
  )
}

function StackPin({ bubble, openId, onOpen, onFan }: { bubble: MapBubble; openId: number; onOpen: (id: number) => void; onFan: (id: number) => void }) {
  const [top, ...rest] = bubble.members
  const openMember = bubble.members.find((m) => m.id === openId)
  // A stack hiding the open studio gets the ring and that studio's name.
  const name =
    openMember && openMember !== top
      ? `${openMember.rank === null ? '🌱' : `${openMember.rank}.`} ${openMember.name}`
      : (top.rank !== null && top.rank <= NAMED) || openMember
        ? top.name
        : null
  return (
    <Pin card={top} x={bubble.x} y={bubble.y} r={bubble.r} open={Boolean(openMember)} name={name} onOpen={onOpen}>
      {rest.length > 0 && (
        <button
          type="button"
          className="more"
          aria-label={`${rest.length} more studio${rest.length === 1 ? '' : 's'} here: ${rest.map((m) => m.name).join(', ')}`}
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
function Fan({ bubble, box, openId, onOpen, onClose }: { bubble: MapBubble; box: { width: number; height: number }; openId: number; onOpen: (id: number) => void; onClose: () => void }) {
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
        return <Pin key={card.id} card={card} x={x} y={y} r={r} open={card.id === openId} name={card.name} onOpen={onOpen} className="fanned" autoFocus={i === 0} />
      })}
    </>
  )
}

type TilesProps = MapProps & { zoom: StudioLabel | null; onZoom: (label: StudioLabel | null) => void }

/** The phone's map: four label tiles, or one corner zoomed to the whole box. */
export function LabelTiles({ cards, lines, openId, onOpen, zoom, onZoom }: TilesProps) {
  if (zoom) return <ZoomedCorner cards={cards} lines={lines} openId={openId} onOpen={onOpen} label={zoom} onBack={() => onZoom(null)} />
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
              {mine.slice(0, 4).map((c) => (c.cover ? <img key={c.id} src={c.cover} alt="" /> : <i key={c.id} />))}
              {mine.length > 4 && <em>+{mine.length - 4}</em>}
            </span>
            <span className="c">
              {mine.length} studio{mine.length === 1 ? '' : 's'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ZoomedCorner({ cards, lines, openId, onOpen, label, onBack }: MapProps & { label: StudioLabel; onBack: () => void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = Math.round(width * 0.92)
  const bubbles = useMemo(() => (width ? cornerMap(cards, label, lines, { width, height }) : []), [cards, label, lines, width, height])
  return (
    <div className={`st-map st-zoom card ${label}`} ref={ref} style={{ height: height || undefined }} role="group" aria-label={`${LABELS[label].name} studios`}>
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
