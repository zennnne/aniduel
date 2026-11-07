// The label map (#89): studios as cover bubbles on hit rate × flop rate, the four labels as its corners.
import { describe, expect, it } from 'vitest'
import type { StudioLabel } from '../loadTopStudios.ts'
import { cornerMap, labelMap, type MapBubble } from './labelMap.ts'
import type { StudioCard } from './resultView.ts'

let nextId = 1
function card(label: StudioLabel, hitRate: number, flopRate: number, score = 0.2, rank: number | null = nextId): StudioCard {
  const id = nextId++
  return { id, name: `S${id}`, rank, label, score, hearts: 3, votes: 8, hitRate, flopRate, cover: null, coverColor: null, banner: null, page: null }
}

const lines = { hit: 0.2, flop: 0.2 }
const size = { width: 600, height: 468 }

const corner = ({ x, y }: MapBubble, { width, height } = size): StudioLabel =>
  y < height / 2 ? (x < width / 2 ? 'elite' : 'bold') : x < width / 2 ? 'reliable' : 'meh'

const overlapping = (bubbles: MapBubble[]) =>
  bubbles.some((a, i) => bubbles.slice(i + 1).some((b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5))

const inside = (b: MapBubble, { width, height } = size) =>
  b.x - b.r >= 0 && b.x + b.r <= width && b.y - b.r >= 0 && b.y + b.r <= height

describe('the label map', () => {
  it('puts each studio in its label’s corner: hits up, flops across', () => {
    const cards = [card('elite', 0.4, 0.05), card('bold', 0.35, 0.3), card('reliable', 0.1, 0.1), card('meh', 0.05, 0.4)]
    const bubbles = labelMap(cards, lines, size)

    expect(bubbles.map((b) => [b.members[0].label, corner(b)])).toEqual(cards.map((c) => [c.label, c.label]))
    expect(bubbles.every((b) => inside(b))).toBe(true)
  })

  it('keeps a studio on its label’s side even when its rates sit right at the line', () => {
    // Labels are decided by "above the line", so a studio at the line is low on that rate.
    const bubbles = labelMap([card('reliable', 0.2, 0.2), card('elite', 0.2001, 0)], lines, size)
    expect(bubbles.map((b) => corner(b))).toEqual(['reliable', 'elite'])
  })

  it('keeps bubbles, and the name tags under them, clear of the corner names at the top and bottom', () => {
    // Studios at the far edges of every corner: the highest hit rate up top, none at all down below.
    const cards = [card('elite', 0.9, 0), card('bold', 0.9, 0.9), card('reliable', 0, 0), card('meh', 0, 0.9)]
    for (const box of [size, { width: 900, height: 702 }]) {
      for (const b of labelMap(cards, lines, box)) {
        // A corner name: 14px padding and two lines, 46px from its edge; a name tag: 6px gap and 13px under a bubble.
        if (b.y < box.height / 2) expect(b.y - b.r).toBeGreaterThanOrEqual(46)
        else expect(b.y + b.r + 19).toBeLessThanOrEqual(box.height - 46)
      }
    }
  })

  it('merges studios of one label that would overlap into a stack, the higher Studio Score on top', () => {
    const low = card('reliable', 0.1, 0.1, 0.1)
    const high = card('reliable', 0.1, 0.1, 0.5)
    const bubbles = labelMap([low, high], lines, size)

    expect(bubbles).toHaveLength(1)
    expect(bubbles[0].members.map((m) => m.id)).toEqual([high.id, low.id])
  })

  it('never stacks studios of different labels, and packs bubbles so none overlap', () => {
    const cards = [
      ...Array.from({ length: 12 }, (_, i) => card('reliable', 0.02 * (i % 10), 0.015 * i, 0.05 * i)),
      ...Array.from({ length: 6 }, (_, i) => card('meh', 0.03 * i, 0.25 + 0.02 * i)),
      card('elite', 0.2001, 0.2),
    ]
    const bubbles = labelMap(cards, lines, size)

    expect(bubbles.every((b) => b.members.every((m) => m.label === b.members[0].label))).toBe(true)
    expect(bubbles.flatMap((b) => b.members)).toHaveLength(cards.length)
    expect(overlapping(bubbles)).toBe(false)
    expect(bubbles.every((b) => corner(b) === b.members[0].label && inside(b))).toBe(true)
  })

  it('draws a better studio bigger, and a watchlist studio small', () => {
    const [best, worse, watch] = labelMap(
      [card('elite', 0.4, 0, 0.8), card('bold', 0.4, 0.4, 0.1), card('meh', 0, 0.4, 0.8, null)],
      lines,
      size,
    )
    expect(best.r).toBeGreaterThan(worse.r)
    expect(watch.r).toBeLessThan(worse.r)
  })
})

describe('a zoomed corner (phone)', () => {
  it('spreads one label’s studios over the whole box, each its own bubble, none overlapping', () => {
    const cards = [
      ...Array.from({ length: 8 }, (_, i) => card('reliable', 0.1, 0.1, 0.05 * i)),
      card('elite', 0.4, 0),
    ]
    const box = { width: 350, height: 320 }
    const bubbles = cornerMap(cards, 'reliable', lines, box)

    expect(bubbles).toHaveLength(8)
    expect(bubbles.every((b) => b.members.length === 1 && b.members[0].label === 'reliable')).toBe(true)
    expect(overlapping(bubbles)).toBe(false)
    expect(bubbles.every((b) => inside(b, box))).toBe(true)
  })
})
