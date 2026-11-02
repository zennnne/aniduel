// Where the label map (#89) draws each studio: a cover bubble on hit rate (up) × flop rate (across), the label lines
// through the middle so the four corners are the four labels. Bubbles of one label that would overlap merge into a
// "+N" stack. Pure geometry in pixels of the box it is given; the map component measures the box.
import { labelRates, type StudioLabel, type TopStudios } from '../loadTopStudios.ts'
import type { StudioCard } from './resultView.ts'

/** A bubble on the map: one studio, or a stack of them with the best on top. */
export type MapBubble = { members: StudioCard[]; x: number; y: number; r: number }

export type Box = { width: number; height: number }
/** The rates a studio must pass to read high. */
export type LabelLines = TopStudios['labelLines']

/** Room left at the top and bottom of the map for the corner names (14px padding and two lines, in studios.css), and a little air. */
const LABEL_ROOM = 42
const EDGE = 6
/** Room under a bubble for its name tag (6px gap and a 13px tag), kept clear of the bottom corner names. */
const NAME_ROOM = 19
const GAP = 6
/** Same-label bubbles closer than this share of their radii merge into a stack. */
const MERGE = 0.9

/** A box narrower than this gets the phone's smaller bubbles. */
const SMALL_BOX = 480

function radius(card: StudioCard, small: boolean): number {
  if (card.rank === null) return small ? 12 : 16
  return (small ? 12 : 18) + Math.max(0, card.score) * (small ? 12 : 22)
}

/** 0–1 across (flop rate) and down (1 − hit rate), the label line at 0.5 on each. */
function plane(cards: readonly StudioCard[], lines: LabelLines) {
  const maxHit = Math.max(lines.hit + 0.1, ...cards.map((c) => c.hitRate))
  const maxFlop = Math.max(lines.flop + 0.1, ...cards.map((c) => c.flopRate))
  const half = (v: number, line: number, max: number) => (v <= line ? (line > 0 ? v / line : 0) * 0.5 : 0.5 + ((v - line) / (max - line)) * 0.5)
  return (c: StudioCard) => ({ x: half(c.flopRate, lines.flop, maxFlop), y: 1 - half(c.hitRate, lines.hit, maxHit) })
}

type Pin = MapBubble & { order: number }

/** Pushes overlapping bubbles apart, `keep` holding each in its area; shrinks them all when the area is too tight. */
function pack(pins: Pin[], keep: (p: Pin) => void): Pin[] {
  for (let round = 0; round < 12; round++) {
    pins.forEach(keep)
    for (let it = 0; it < 240; it++) {
      for (let i = 0; i < pins.length; i++)
        for (let j = i + 1; j < pins.length; j++) {
          const a = pins[i]
          const b = pins[j]
          let dx = b.x - a.x
          let dy = b.y - a.y
          // Two bubbles on the same spot part along a fixed direction of their own.
          if (dx === 0 && dy === 0) [dx, dy] = [Math.cos(i + j), Math.sin(i + j)]
          const d = Math.hypot(dx, dy)
          const min = a.r + b.r + GAP
          if (d < min) {
            const p = (min - d) / 2
            a.x -= (dx / d) * p
            a.y -= (dy / d) * p
            b.x += (dx / d) * p
            b.y += (dy / d) * p
          }
        }
      pins.forEach(keep)
    }
    const crowded = pins.some((a, i) => pins.slice(i + 1).some((b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r))
    if (!crowded) break
    for (const p of pins) p.r *= 0.88
  }
  return pins
}

const settled = (pins: Pin[]): MapBubble[] =>
  pins.sort((a, b) => a.order - b.order).map(({ members, x, y, r }) => ({ members, x, y, r }))

/** The whole map: every card in its label's corner, overlapping ones of one label stacked. In the cards' order. */
export function labelMap(cards: readonly StudioCard[], lines: LabelLines, { width, height }: Box): MapBubble[] {
  const small = width < SMALL_BOX
  const at = plane(cards, lines)
  const pins = cards.map((card, order) => {
    const { x, y } = at(card)
    return { x: x * width, y: y * height, r: radius(card, small), card, order }
  })

  // Best first, so a stack shows its best studio and sits where that one would.
  const groups: Pin[] = []
  for (const pin of [...pins].sort((a, b) => b.card.score - a.card.score)) {
    const into = groups.find(
      (g) => g.members[0].label === pin.card.label && Math.hypot(g.x - pin.x, g.y - pin.y) < (g.r + pin.r) * MERGE,
    )
    if (into) {
      into.members.push(pin.card)
      into.order = Math.min(into.order, pin.order)
    } else groups.push({ members: [pin.card], x: pin.x, y: pin.y, r: pin.r, order: pin.order })
  }

  const keep = (p: Pin) => {
    // Hits high on top, flops high on the right.
    const { hitsHigh, flopsHigh } = labelRates(p.members[0].label)
    const m = p.r + EDGE
    const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)))
    p.x = flopsHigh ? clamp(p.x, width / 2 + m, width - m) : clamp(p.x, m, width / 2 - m)
    p.y = hitsHigh ? clamp(p.y, m + LABEL_ROOM, height / 2 - m) : clamp(p.y, height / 2 + m, height - m - LABEL_ROOM - NAME_ROOM)
  }
  return settled(pack(groups, keep))
}

/** Room at the top of a zoomed corner for its back button and name. */
const CORNER_TOP = 44
const CORNER_SIDE = 10
/** Room under the lowest bubbles for their name tags. */
const CORNER_BOTTOM = 24

/** One label's corner zoomed to the whole box (the phone's tiles): its studios spread out, one bubble each. */
export function cornerMap(cards: readonly StudioCard[], label: StudioLabel, lines: LabelLines, { width, height }: Box): MapBubble[] {
  const at = plane(cards, lines)
  const mine = cards.map((card, order) => ({ card, order, ...at(card) })).filter((p) => p.card.label === label)
  const span = (vs: number[]) => [Math.min(...vs), Math.max(...vs)] as const
  const [x0, x1] = span(mine.map((p) => p.x))
  const [y0, y1] = span(mine.map((p) => p.y))
  const stretch = (v: number, lo: number, hi: number, from: number, to: number) => (hi > lo ? from + ((v - lo) / (hi - lo)) * (to - from) : (from + to) / 2)
  const pins: Pin[] = mine.map((p) => ({
    members: [p.card],
    order: p.order,
    x: stretch(p.x, x0, x1, width * 0.15, width * 0.85),
    y: stretch(p.y, y0, y1, CORNER_TOP + 30, height - CORNER_BOTTOM - 20),
    r: p.card.rank === null ? 13 : 15 + Math.max(0, p.card.score) * 14,
  }))
  const keep = (p: Pin) => {
    p.x = Math.min(width - p.r - CORNER_SIDE, Math.max(p.r + CORNER_SIDE, p.x))
    p.y = Math.min(height - p.r - CORNER_BOTTOM, Math.max(p.r + CORNER_TOP, p.y))
  }
  return settled(pack(pins, keep))
}
