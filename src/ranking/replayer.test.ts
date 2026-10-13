import { describe, expect, it } from 'vitest'
import {
  BANDS,
  ReplayError,
  appendEvent,
  replay,
  replayer,
  startKeepMyScaleLog,
  startLog,
  withSub,
  type BandIndex,
  type DuelLog,
  type LogEvent,
  type RankingState,
  type SubBandIndex,
} from './engine.ts'
import engine6 from './fixtures/engine6-log.json'
import { defaultCuts } from './split.ts'

/** A seeded user: mostly answers the prompt, now and then fixes, syncs, switches, undoes, or sends a refused event. */
function user(seed: number) {
  let s = seed
  const random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
  const value = (id: number) => (id * 7919) % 101
  let added = 1000

  function answer(state: RankingState): LogEvent {
    const p = state.prompt
    if (p.kind === 'rough-sort') {
      const band = pick(BANDS)
      return withSub({ type: 'band-assigned', id: p.id, band }, state.bands[band].subBands ? pick([0, 1, 2] as const) : undefined)
    }
    if (p.kind === 'closer-to') return { type: 'closer-to-answered', id: p.id, level: pick([p.upper, p.lower]) }
    if (p.kind === 'all-complete') return { type: 'undo' }
    if (state.bandChoice && random() < 0.5) return { type: 'band-selected', band: pick(BANDS) }
    const result = random() < 0.1 ? 'tie' : value(p.a) > value(p.b) ? 'a' : 'b'
    return { type: 'duel-answered', a: p.a, b: p.b, result }
  }

  function other(state: RankingState): LogEvent {
    const inBands = state.bands.flatMap((band) => [...band.tiers.flat(), ...band.unplaced])
    const known = [...inBands, ...(state.keepMyScale?.titles.map((t) => t.id) ?? []), ...(state.keepMyScale?.levels.flatMap((l) => l.anchors) ?? [])]
    const id = pick(known.length ? known : [0])
    const band = pick(BANDS)
    const sub: SubBandIndex | undefined = state.bands[band].subBands ? pick([0, 1, 2] as const) : undefined
    switch (Math.floor(random() * 10)) {
      case 0:
        return { type: 'undo' }
      case 1:
        return { type: 'forgotten', id }
      case 2:
        return { type: 'unforgotten', id: pick(state.forgotten.length ? state.forgotten : [0]) }
      case 3:
        return { type: 'rerank-requested', id }
      case 4:
        return withSub({ type: 'band-moved', id, band }, sub)
      case 5: {
        const { tiers, unplaced } = state.bands[band]
        const third = Math.ceil(unplaced.length / 3)
        const parts: [number[], number[], number[]] = [unplaced.slice(0, third), unplaced.slice(third, 2 * third), unplaced.slice(2 * third)]
        return { type: 'band-split', band, cuts: defaultCuts(tiers.map((tier) => tier.length)), unplaced: parts }
      }
      case 6:
        return { type: 'sort-goal-set', goal: state.sortGoal === 'scores' ? 'full-ranking' : 'scores' }
      case 7:
        return { type: 'titles-added', ids: [added++, added++] }
      case 8:
        return { type: 'titles-removed', ids: [id] }
      default:
        // Refused at its second title, after the first one was added.
        return { type: 'titles-added', ids: [added++, id] }
    }
  }

  return (state: RankingState): LogEvent => (random() < 0.85 ? answer(state) : other(state))
}

const outcome = (run: () => RankingState): RankingState | string => {
  try {
    return run()
  } catch (error) {
    if (!(error instanceof ReplayError)) throw error
    return error.message
  }
}

function expectSame(actual: RankingState | string, expected: RankingState | string): void {
  expect(actual).toEqual(expected)
  if (typeof actual === 'string' || typeof expected === 'string') return
  // The Board is built on first read, so `toEqual` alone never looks inside it.
  expect(actual.board.bands).toEqual(expected.board.bands)
}

/** Drives `start` with a seeded user; after every event the replayer must give what a replay from the start gives. */
function drive(start: DuelLog, seed: number, steps: number): { refused: number; applied: number } {
  const next = user(seed)
  const live = replayer()
  let log = start
  let shown = live(log)
  let refused = 0
  let applied = 0
  for (let i = 0; i < steps; i++) {
    const appended = appendEvent(log, next(shown))
    const expected = outcome(() => replay(appended))
    const actual = outcome(() => live(appended))
    // Checked only now, after the replayer has moved on: a state must not change once it is returned.
    expectSame(shown, replay(log))
    expect(typeof actual).toBe(typeof expected)
    if (typeof actual === 'string' || typeof expected === 'string') {
      expect(actual).toBe(expected)
      refused++
      continue
    }
    log = appended
    shown = actual
    applied++
  }
  expectSame(shown, replay(log))
  return { refused, applied }
}

const ids = Array.from({ length: 36 }, (_, i) => i + 1)
const anime = { userId: 7, mediaType: 'ANIME' as const }

describe('replayer', () => {
  it.each([1, 2, 3])('gives what replay gives after every event of a Full Ranking (seed %i)', (seed) => {
    const { refused, applied } = drive(startLog({ ...anime, seed, ids }), seed, 500)
    expect(refused).toBeGreaterThan(0)
    expect(applied).toBeGreaterThan(300)
  })

  it.each([4, 5, 6])('gives what replay gives after every event on Scores (seed %i)', (seed) => {
    const { refused, applied } = drive(startLog({ ...anime, seed, ids, scoreFormat: 'POINT_10' }), seed, 500)
    expect(refused).toBeGreaterThan(0)
    expect(applied).toBeGreaterThan(300)
  })

  it.each([7, 8])('gives what replay gives after every event of a Keep My Scale Ranking (seed %i)', (seed) => {
    const anchors = Array.from({ length: 24 }, (_, i) => ({ id: 101 + i, level: 10 - Math.floor(i / 4) }))
    const split = seed === 8 ? ('deciding-duels' as const) : undefined
    const start = startKeepMyScaleLog({ ...anime, seed, format: 'POINT_10', anchors, ids: ids.slice(0, 12), split })
    expect(drive(start, seed, 300).applied).toBeGreaterThan(100)
  })

  it('follows a log whose header gets a newer engine version when an event is appended', () => {
    const old = engine6 as DuelLog
    const live = replayer()
    expectSame(live(old), replay(old))
    const band: BandIndex = 0
    const moved = appendEvent(old, { type: 'band-moved', id: replay(old).bands.flatMap((b) => b.tiers.flat())[0], band })
    expect(moved.header.engine).toBeGreaterThan(old.header.engine)
    expectSame(live(moved), replay(moved))
  })

  it('forgets what a refused event changed before it was refused', () => {
    const live = replayer()
    const log = startLog({ ...anime, seed: 1, ids: [1, 2, 3] })
    live(log)
    // Title 50 is added before title 1 is refused.
    expect(() => live(appendEvent(log, { type: 'titles-added', ids: [50, 1] }))).toThrow(ReplayError)
    const added = appendEvent(log, { type: 'titles-added', ids: [50] })
    expectSame(live(added), replay(added))
  })

  it('replays another log from the start', () => {
    const live = replayer()
    const one = startLog({ ...anime, seed: 1, ids: [1, 2, 3] })
    const other = startLog({ ...anime, seed: 1, ids: [4, 5] })
    live(appendEvent(one, { type: 'band-assigned', id: 1, band: 0 }))
    expectSame(live(appendEvent(other, { type: 'band-assigned', id: 4, band: 2 })), replay(appendEvent(other, { type: 'band-assigned', id: 4, band: 2 })))
    expectSame(live(one), replay(one))
  })
})
