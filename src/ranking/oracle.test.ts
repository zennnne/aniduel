// Property tests (issue #1, Testing Decisions): a consistent oracle answering every Duel through `replay`
// ends with a Ranking in its own order, using about as few Duels as binary insertion allows.
import { describe, expect, it } from 'vitest'
import { BANDS, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from './engine.ts'

/** Small seeded PRNG (mulberry32), so every case is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Case = { ids: number[]; band: Map<number, BandIndex>; value: Map<number, number> }

/** `n` titles in random Bands; values drawn from `levels` distinct values (few levels = many ties). */
function randomCase(random: () => number, n: number, levels: number, bands: readonly BandIndex[] = BANDS): Case {
  const ids = Array.from({ length: n }, (_, i) => 1000 + i * 7)
  const band = new Map(ids.map((id) => [id, bands[Math.floor(random() * bands.length)]]))
  const value = new Map(ids.map((id) => [id, Math.floor(random() * levels)]))
  return { ids, band, value }
}

/**
 * Plays a whole Ranking through `replay`: Rough Sort by the case's Bands, then every Duel answered by the oracle.
 * With `forgetChance`, before an answer it sometimes marks the inserting title, its opponent or a random placed
 * title as Forgotten instead.
 */
function play(c: Case, random: () => number, forgetChance = 0): { state: RankingState; duels: number; log: DuelLog } {
  let log = startLog({ seed: Math.floor(random() * 2 ** 32), userId: 1, mediaType: 'ANIME', ids: c.ids })
  const push = (event: LogEvent) => {
    log = { ...log, events: [...log.events, event] }
  }
  let duels = 0
  for (let state = replay(log); ; state = replay(log)) {
    const p = state.prompt
    if (p.kind === 'all-complete') return { state, duels, log }
    if (p.kind === 'rough-sort') {
      push({ type: 'band-assigned', id: p.id, band: c.band.get(p.id)! })
      continue
    }
    if (random() < forgetChance) {
      const placed = state.bands.flatMap((b) => b.tiers.flat())
      const choices = [p.a, p.b, placed[Math.floor(random() * placed.length)]]
      push({ type: 'forgotten', id: choices[Math.floor(random() * choices.length)] })
      continue
    }
    // Name the pair in a random order: the answer is by id, so order must not matter.
    const [x, y] = random() < 0.5 ? [p.a, p.b] : [p.b, p.a]
    const vx = c.value.get(x)!
    const vy = c.value.get(y)!
    push({ type: 'duel-answered', a: x, b: y, result: vx === vy ? 'tie' : vx > vy ? 'a' : 'b' })
    duels++
    if (duels > 100_000) throw new Error('runaway')
  }
}

/** Checks a Band's Tiers against the oracle: strictly better Tier first, and equal titles share one Tier. */
function expectOracleOrder(tiers: readonly (readonly number[])[], value: Map<number, number>): void {
  const tierValues = tiers.map((tier) => {
    const values = new Set(tier.map((id) => value.get(id)))
    expect(values.size).toBe(1)
    return value.get(tier[0])!
  })
  for (let i = 1; i < tierValues.length; i++) expect(tierValues[i]).toBeLessThan(tierValues[i - 1])
}

const log2 = Math.log2
const log2Factorial = (k: number) => Array.from({ length: k }, (_, i) => log2(i + 1)).reduce((s, x) => s + x, 0)

describe('a consistent oracle answering every Duel', () => {
  it('ends with every Band in the oracle\'s order, ties as one Tier, and every title placed', () => {
    const random = rng(1)
    for (let trial = 0; trial < 150; trial++) {
      const n = 1 + Math.floor(random() * 50)
      const levels = 1 + Math.floor(random() * 30)
      const c = randomCase(random, n, levels)
      const { state } = play(c, random)
      for (const band of BANDS) {
        const b = state.bands[band]
        expect(b.unplaced).toEqual([])
        expectOracleOrder(b.tiers, c.value)
        expect(b.tiers.flat().every((id) => c.band.get(id) === band)).toBe(true)
      }
      expect(state.progress.ranked).toEqual({ done: n, total: n })
    }
  })

  it('stays inside the binary-insertion bound per Band, counting each Tier once', () => {
    const random = rng(2)
    for (let trial = 0; trial < 150; trial++) {
      const c = randomCase(random, 1 + Math.floor(random() * 60), 1 + Math.floor(random() * 40))
      const { state, duels } = play(c, random)
      // Inserting the i-th title of a Band faces at most min(i, t) Tiers, t = the Band's final Tier count.
      let bound = 0
      for (const band of BANDS) {
        const n = state.bands[band].tiers.flat().length
        const t = state.bands[band].tiers.length
        for (let i = 1; i < n; i++) bound += Math.ceil(log2(Math.min(i, t) + 1))
      }
      expect(duels).toBeLessThanOrEqual(bound)
    }
  })

  it('needs close to log2(k!) Duels per Band when every title is different', () => {
    const random = rng(3)
    for (let trial = 0; trial < 20; trial++) {
      const n = 100 + Math.floor(random() * 100)
      const c = randomCase(random, n, 1_000_000_000)
      const { state, duels } = play(c, random)
      const ideal = state.bands.reduce((sum, band) => sum + log2Factorial(band.tiers.length), 0)
      expect(duels).toBeGreaterThanOrEqual(Math.floor(ideal * 0.95))
      expect(duels).toBeLessThanOrEqual(Math.ceil(ideal * 1.1))
    }
    // About 5 s since #26 on a busy machine: replay after every answer, 20 Pools of 100-200 titles.
  }, 30_000)

  it('keeps the oracle\'s order when titles, including pivots, are marked Forgotten mid-insertion', () => {
    const random = rng(4)
    for (let trial = 0; trial < 150; trial++) {
      const c = randomCase(random, 2 + Math.floor(random() * 40), 1 + Math.floor(random() * 20), [0, 1])
      const { state } = play(c, random, 0.15)
      for (const band of BANDS) {
        expect(state.bands[band].unplaced).toEqual([])
        expectOracleOrder(state.bands[band].tiers, c.value)
      }
      const placed = state.bands.flatMap((b) => b.tiers.flat())
      expect(new Set([...placed, ...state.forgotten])).toEqual(new Set(c.ids))
      expect(placed.some((id) => state.forgotten.includes(id))).toBe(false)
    }
  })

  it('keeps the oracle\'s order when syncs add and remove titles (pivots included) mid-Ranking', () => {
    const random = rng(6)
    for (let trial = 0; trial < 100; trial++) {
      const c = randomCase(random, 30, 1 + Math.floor(random() * 15), [0, 1])
      // Start with half of the titles; the rest arrive through syncs, and some leave (and may come back).
      const outside = c.ids.slice(15)
      let log = startLog({ seed: trial, userId: 1, mediaType: 'ANIME', ids: c.ids.slice(0, 15) })
      const push = (event: LogEvent) => {
        log = { ...log, events: [...log.events, event] }
      }
      for (let state = replay(log), steps = 0; ; state = replay(log), steps++) {
        if (steps > 10_000) throw new Error('runaway')
        const p = state.prompt
        if (random() < 0.08) {
          const inPool = c.ids.filter((id) => !outside.includes(id))
          if (outside.length > 0 && random() < 0.5) {
            push({ type: 'titles-added', ids: outside.splice(0, 1 + Math.floor(random() * 3)) })
          } else if (inPool.length > 0) {
            const choices = p.kind === 'duel' ? [p.a, p.b, ...inPool] : inPool
            const id = choices[Math.floor(random() * choices.length)]
            push({ type: 'titles-removed', ids: [id] })
            outside.push(id)
          }
          continue
        }
        if (p.kind === 'all-complete') break
        if (p.kind === 'rough-sort') push({ type: 'band-assigned', id: p.id, band: c.band.get(p.id)! })
        else {
          const vx = c.value.get(p.a)!
          const vy = c.value.get(p.b)!
          push({ type: 'duel-answered', a: p.a, b: p.b, result: vx === vy ? 'tie' : vx > vy ? 'a' : 'b' })
        }
      }
      const state = replay(log)
      for (const band of BANDS) expectOracleOrder(state.bands[band].tiers, c.value)
      const placed = state.bands.flatMap((b) => b.tiers.flat())
      expect(new Set(placed)).toEqual(new Set(c.ids.filter((id) => !outside.includes(id))))
      expect(state.progress.ranked).toEqual({ done: placed.length, total: placed.length })
    }
  })

  it('replays the same log to the same Ranking every time', () => {
    const random = rng(5)
    const c = randomCase(random, 40, 12)
    const { state, log } = play(c, random, 0.1)
    expect(replay(log)).toEqual(state)
    expect(replay(structuredClone(log))).toEqual(state)
  })
})
