// The "All N titles" swarm (#89): round covers along the user's score line, size by weight.
import { describe, expect, it } from 'vitest'
import { swarm } from './swarm.ts'

const titles = (scores: Array<[score: number, weight: number]>) => scores.map(([score, weight], i) => ({ id: i, score, weight }))

describe('the swarm', () => {
  it('places covers along the score line, higher scores further right, with ticks from the lowest score to 10', () => {
    const { beads, ticks, at } = swarm(titles([[4, 1], [7, 1], [10, 1]]), 6.2, { width: 620, height: 220 })

    const xs = [0, 1, 2].map((id) => beads.find((b) => b.item.id === id)!.x)
    expect(xs[0]).toBeLessThan(xs[1])
    expect(xs[1]).toBeLessThan(xs[2])
    expect(ticks).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(at(6.2)).toBeGreaterThan(at(6))
    expect(at(6.2)).toBeLessThan(at(7))
  })

  it('draws a heavier title bigger, and keeps covers on the same score from overlapping', () => {
    const { beads } = swarm(titles([[8, 2], [8, 0.5], [8, 1], [8, 1], [8, 1]]), 6, { width: 320, height: 240 })

    expect(beads.find((b) => b.item.id === 0)!.r).toBeGreaterThan(beads.find((b) => b.item.id === 1)!.r)
    const overlap = beads.some((a, i) => beads.slice(i + 1).some((b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5))
    expect(overlap).toBe(false)
  })

  it('reaches down to the user’s usual score when every title sits above it', () => {
    expect(swarm(titles([[9, 1]]), 5.4, { width: 620, height: 220 }).ticks[0]).toBe(5)
  })
})
