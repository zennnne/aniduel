// The Split screen's view (ADR 0006): the offer, the three columns and what they save, and the one event Done records.
import { describe, expect, it } from 'vitest'
import { appendEvent, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type SubBandIndex } from '../../ranking/engine.ts'
import {
  keepSorting,
  moveDivider,
  moveTitle,
  splitView,
  startingChoices,
  takeOffer,
  type SplitChoices,
  type SplitInput,
  type SplitView,
} from './splitView.ts'

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i)
const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => ({ ...log, events: [...log.events, ...events] })

/** `counts[b]` titles assigned to Band b (ids from 1, Band by Band), Rough Sort finished, no Duel answered. */
function afterRoughSort(counts: number[], scoreFormat?: 'POINT_3'): DuelLog {
  const ids = range(1, counts.reduce((a, b) => a + b, 0))
  let next = 0
  const assigned = counts.flatMap((n, band) => range(0, n).map((): LogEvent => ({ type: 'band-assigned', id: ids[next++], band: band as BandIndex })))
  return plus(startLog({ seed: 1, userId: 1, mediaType: 'ANIME', ids, ...(scoreFormat ? { scoreFormat } : {}) }), ...assigned)
}

/** `count` titles, all Loved, with Duels answered (the lower id is better) until Loved has `tiers` Tiers. */
function lovedWithTiers(count: number, tiers: number): DuelLog {
  let log = afterRoughSort([count])
  for (let state = replay(log); state.bands[0].tiers.length < tiers; state = replay(log)) {
    if (state.prompt.kind !== 'duel') throw new Error('expected a Duel')
    const { a, b } = state.prompt
    log = plus(log, { type: 'duel-answered', a, b, result: a < b ? 'a' : 'b' })
  }
  return log
}

/** The Split screen on Loved, as it opens. */
function opened(log: DuelLog): SplitInput {
  const state = replay(log)
  return { state, band: 0, choices: startingChoices(state, 0) }
}

/** The Split screen on Loved with the offer taken. */
function sorting(log: DuelLog): SplitInput {
  const input = opened(log)
  return { ...input, choices: takeOffer(input.choices) }
}

const withChoices = (input: SplitInput, choices: SplitChoices): SplitInput => ({ ...input, choices })

/** The screen after covers are moved, each to a Sub-band. */
const moved = (input: SplitInput, moves: readonly (readonly [number, SubBandIndex])[]): SplitInput =>
  moves.reduce((at, [id, subBand]) => withChoices(at, moveTitle(at, id, subBand)), input)

const columnsOf = (input: SplitInput) => {
  const view = splitView(input)
  if (view.step !== 'columns') throw new Error(`expected the columns, got ${view.step}`)
  return view
}

/** The ids in each column, the single ranked title among them. */
const idsIn = (view: Extract<SplitView, { step: 'columns' }>) => view.columns.map((cards) => cards.map((card) => card.id))

/** Six titles, all Loved. After Rough Sort title 1 already has a place (the first needs no Duel); 2..6 wait. */
const freshLoved = () => afterRoughSort([6])
/** 95 titles in Loved (1 with a place, 94 without) and 5 in every other Band. */
const oversized = () => afterRoughSort([95, 5, 5, 5, 5])
/** A quarter of Loved's 94 titles without a place to Best and a quarter to Lowest. */
const quarters = [...range(2, 24).map((id) => [id, 0] as const), ...range(72, 24).map((id) => [id, 2] as const)]

describe('the offer to split an oversized Band', () => {
  it('is what the Split screen opens with', () => {
    expect(splitView(opened(oversized())).step).toBe('offer')
  })

  it('counts the worst-case Duels over every Band now and after a ¼ / ½ / ¼ split of this one', () => {
    // Loved alone is up to 538 Duels; each Band of 5 is up to 1 + 2 + 2 + 3. Split 24 / (1 + 46) / 24, Loved is 397.
    expect(splitView(opened(oversized()))).toMatchObject({ duelsNow: 570, duelsAfter: 429, savings: 141 })
  })

  it('charts a bar per Band with its titles, marking the Band the offer is about', () => {
    const view = splitView(opened(oversized()))
    expect(view.step === 'offer' && view.bars).toEqual([
      { band: 0, subBand: null, count: 95, oversized: true },
      { band: 1, subBand: null, count: 5, oversized: false },
      { band: 2, subBand: null, count: 5, oversized: false },
      { band: 3, subBand: null, count: 5, oversized: false },
      { band: 4, subBand: null, count: 5, oversized: false },
    ])
  })

  it('gives way to the three columns once it is taken', () => {
    const input = opened(freshLoved())
    expect(input.choices.sorting).toBe(false)
    expect(splitView(withChoices(input, takeOffer(input.choices))).step).toBe('columns')
  })
})

describe('the three columns', () => {
  it('start with every title in Middle: the single ranked title first, then those without a place in insertion order', () => {
    const view = columnsOf(sorting(freshLoved()))
    expect(view.columns).toEqual([
      [],
      [
        { id: 1, ranked: true },
        { id: 2, ranked: false },
        { id: 3, ranked: false },
        { id: 4, ranked: false },
        { id: 5, ranked: false },
        { id: 6, ranked: false },
      ],
      [],
    ])
    expect(view.strip).toBeNull()
  })

  it('take a moved title into its new Sub-band, in insertion order whatever the order of the moves', () => {
    const input = moved(sorting(freshLoved()), [
      [6, 0],
      [3, 2],
      [2, 0],
    ])
    expect(idsIn(columnsOf(input))).toEqual([[2, 6], [1, 4, 5], [3]])
    // And back again.
    expect(idsIn(columnsOf(moved(input, [[6, 1]])))).toEqual([[2], [1, 4, 5, 6], [3]])
  })

  it('take the single ranked title to another column, where it still comes first', () => {
    const input = moved(sorting(freshLoved()), [
      [2, 2],
      [1, 2],
    ])
    expect(columnsOf(input).columns[2]).toEqual([
      { id: 1, ranked: true },
      { id: 2, ranked: false },
    ])
  })

  it('change nothing when what is dropped on a column is not a cover of this Band', () => {
    const input = sorting(oversized())
    // 96 is a Liked title; NaN is what a dragged divider or anything else reads as.
    for (const id of [96, 9999, Number.NaN]) expect(moveTitle(input, id, 0)).toBe(input.choices)
  })
})

describe('the "Already ranked" strip', () => {
  /** Ten Loved titles: 1..8 ranked, one Tier each; 9 and 10 without a place. */
  const eightTiers = () => lovedWithTiers(10, 8)

  it('shows the Tiers of a Band with several ranked titles in their order, cut near ¼ and ¾ of the titles', () => {
    const view = columnsOf(sorting(eightTiers()))
    expect(view.strip).toEqual({
      cuts: [2, 6],
      tiers: [
        { titles: [1], subBand: 0 },
        { titles: [2], subBand: 0 },
        { titles: [3], subBand: 1 },
        { titles: [4], subBand: 1 },
        { titles: [5], subBand: 1 },
        { titles: [6], subBand: 1 },
        { titles: [7], subBand: 2 },
        { titles: [8], subBand: 2 },
      ],
    })
  })

  it('leaves only the titles without a place in the columns', () => {
    const input = sorting(eightTiers())
    expect(columnsOf(input).columns).toEqual([[], [{ id: 9, ranked: false }, { id: 10, ranked: false }], []])
    // A ranked title is no cover of the columns, so it can't be moved to one.
    expect(moveTitle(input, 1, 2)).toBe(input.choices)
  })

  it('shows a single Tier of several titles too, which no column could cut', () => {
    const log = plus(afterRoughSort([3]), { type: 'duel-answered', a: 2, b: 1, result: 'tie' })
    const view = columnsOf(sorting(log))
    expect(view.strip).toEqual({ cuts: [0, 1], tiers: [{ titles: [1, 2], subBand: 1 }] })
    expect(view.columns).toEqual([[], [{ id: 3, ranked: false }], []])
  })

  it('moves a divider to a Tier edge, and the Tiers it passes change Sub-band', () => {
    const input = sorting(eightTiers())
    const best = withChoices(input, moveDivider(input, 0, 4))
    expect(columnsOf(best).strip?.cuts).toEqual([4, 6])
    expect(columnsOf(best).strip?.tiers.map((tier) => tier.subBand)).toEqual([0, 0, 0, 0, 1, 1, 2, 2])
    const lowest = withChoices(best, moveDivider(best, 1, 7))
    expect(columnsOf(lowest).strip?.cuts).toEqual([4, 7])
    expect(columnsOf(lowest).strip?.tiers.map((tier) => tier.subBand)).toEqual([0, 0, 0, 0, 1, 1, 1, 2])
  })

  it('stops a divider at either end of the Band', () => {
    const input = sorting(eightTiers())
    expect(moveDivider(input, 0, -1).cuts).toEqual([0, 6])
    expect(moveDivider(input, 1, 99).cuts).toEqual([2, 8])
  })

  it('takes the other divider along when one would cross it, so Middle is never cut backwards', () => {
    const input = sorting(eightTiers())
    expect(moveDivider(input, 0, 7).cuts).toEqual([7, 7])
    expect(moveDivider(input, 1, 1).cuts).toEqual([1, 1])
  })

  it('counts the places each Sub-band already has in what the split saves', () => {
    const input = sorting(eightTiers())
    // As one Band, 9 and 10 go into 8 and 9 places: 4 + 4 Duels. In a Middle of 4 Tiers: 3 + 3.
    expect(columnsOf(input)).toMatchObject({ duelsAsOneBand: 8, savings: 2 })
    // With no Tier left in Best, 9 goes there with no Duel and 10 into a Middle of 6 Tiers with 3.
    const emptyBest = withChoices(input, moveDivider(input, 0, 0))
    expect(columnsOf(moved(emptyBest, [[9, 0]])).savings).toBe(5)
  })
})

describe('what the split saves', () => {
  it('is nothing while everything is in Middle', () => {
    expect(columnsOf(sorting(oversized()))).toMatchObject({ savings: 0, lowSavings: true, duelsAsOneBand: 538 })
  })

  it('follows every move, and is low under 100 Duels', () => {
    const input = sorting(oversized())
    // One title out of Middle saves its own insertion into 94 places: 7 Duels.
    expect(columnsOf(moved(input, [[2, 0]]))).toMatchObject({ savings: 7, lowSavings: true })
    expect(columnsOf(moved(input, quarters))).toMatchObject({ savings: 141, lowSavings: false })
  })

  it('counts the column the single ranked title is in as the one with a place', () => {
    const input = moved(sorting(freshLoved()), [
      [2, 0],
      [5, 2],
      [6, 2],
    ])
    // As one Band up to 11 Duels. Best 2 / Middle 1 + 3, 4 / Lowest 5, 6: 0 + 3 + 1.
    expect(columnsOf(input)).toMatchObject({ duelsAsOneBand: 11, savings: 7 })
    // With title 1 in Best: Best 1 + 2 / Middle 3, 4 / Lowest 5, 6: 1 + 1 + 1.
    expect(columnsOf(moved(input, [[1, 0]])).savings).toBe(8)
  })

  it('skips settled titles under Scores, though they still go in a column and in the event', () => {
    // On 3 smileys, Loved's 95 titles all sit on the top smiley of 395: settled, with 94 of them without a place.
    const input = moved(sorting(afterRoughSort([95, 0, 0, 0, 300], 'POINT_3')), quarters)
    const view = columnsOf(input)
    expect(view.columns.map((cards) => cards.length)).toEqual([24, 47, 24])
    expect(view).toMatchObject({ savings: 0, lowSavings: true, duelsAsOneBand: 0 })
    const asked = columnsOf(withChoices(input, view.done.ask ? view.done.choices : input.choices))
    expect(asked.warning?.event.unplaced.map((ids) => ids.length)).toEqual([24, 46, 24])
  })
})

describe('pressing Done', () => {
  it('records the split when it saves at least 100 Duels', () => {
    const view = columnsOf(moved(sorting(oversized()), quarters))
    expect(view.done).toEqual({
      ask: false,
      event: { type: 'band-split', band: 0, cuts: [0, 1], unplaced: [range(2, 24), range(26, 46), range(72, 24)] },
    })
    expect(view.warning).toBeNull()
  })

  it('asks first when the split saves less: the warning comes up and nothing is recorded', () => {
    const input = moved(sorting(oversized()), [[2, 0]])
    const { done } = columnsOf(input)
    if (!done.ask) throw new Error('expected the warning')
    expect(done.choices).toEqual({ ...input.choices, warning: true })
    // Middle holds the ranked title and 93 others; a quarter each way would save 141, not 7.
    const asked = columnsOf(withChoices(input, done.choices))
    expect(asked).toMatchObject({ savings: 7, warning: { middle: 94, quarterSavings: 141 } })
  })

  it('lets "Finish anyway" record the split as it is', () => {
    const input = moved(sorting(oversized()), [[2, 0]])
    const { done } = columnsOf(input)
    if (!done.ask) throw new Error('expected the warning')
    expect(columnsOf(withChoices(input, done.choices)).warning?.event).toEqual({
      type: 'band-split',
      band: 0,
      cuts: [0, 1],
      unplaced: [[2], range(3, 93), []],
    })
  })

  it('takes the warning down with "Keep sorting", leaving the columns as they were', () => {
    const input = moved(sorting(oversized()), [[2, 0]])
    const { done } = columnsOf(input)
    if (!done.ask) throw new Error('expected the warning')
    expect(keepSorting(done.choices)).toEqual(input.choices)
    expect(columnsOf(withChoices(input, keepSorting(done.choices))).warning).toBeNull()
  })

  it('asks again while the warning is up, so Enter behind it records nothing', () => {
    const input = moved(sorting(oversized()), [[2, 0]])
    const { done } = columnsOf(input)
    if (!done.ask) throw new Error('expected the warning')
    expect(columnsOf(withChoices(input, done.choices)).done).toEqual({ ask: true, choices: done.choices })
  })
})

describe('the `band-split` event', () => {
  /** The event the columns would record now, whether or not Done asks first. */
  const eventOf = (input: SplitInput) => {
    const { done } = columnsOf(input)
    return done.ask ? columnsOf(withChoices(input, done.choices)).warning!.event : done.event
  }
  const sortedFresh = () =>
    moved(sorting(freshLoved()), [
      [2, 0],
      [5, 2],
      [6, 2],
    ])

  it('is one event with the Band, the cut points and the titles without a place per Sub-band, written as it always was', () => {
    expect(JSON.stringify(eventOf(sortedFresh()))).toBe('{"type":"band-split","band":0,"cuts":[0,1],"unplaced":[[2],[3,4],[5,6]]}')
  })

  it('lists every title without a place in Middle when nothing was moved', () => {
    expect(eventOf(sorting(freshLoved()))).toEqual({ type: 'band-split', band: 0, cuts: [0, 1], unplaced: [[], [2, 3, 4, 5, 6], []] })
  })

  it("names the Band the screen is about, with that Band's titles", () => {
    const state = replay(oversized())
    const input: SplitInput = { state, band: 2, choices: takeOffer(startingChoices(state, 2)) }
    // Okay holds 101..105: 101 has a place, the rest wait.
    expect(eventOf(moved(input, [[103, 0]]))).toEqual({ type: 'band-split', band: 2, cuts: [0, 1], unplaced: [[103], [102, 104, 105], []] })
  })

  it('cuts around the single ranked title by the column it is in', () => {
    const input = sortedFresh()
    expect(eventOf(moved(input, [[1, 0]])).cuts).toEqual([1, 1])
    expect(eventOf(moved(input, [[1, 1]])).cuts).toEqual([0, 1])
    expect(eventOf(moved(input, [[1, 2]])).cuts).toEqual([0, 0])
  })

  it("cuts a Band with the strip at the dividers' Tier edges", () => {
    const input = sorting(lovedWithTiers(10, 8))
    const dragged = withChoices(input, moveDivider(input, 1, 5))
    expect(eventOf(moved(dragged, [[10, 2]]))).toEqual({ type: 'band-split', band: 0, cuts: [2, 5], unplaced: [[], [9], [10]] })
  })

  it('splits the Band when appended to the Duel log, as the single event it adds', () => {
    const log = freshLoved()
    const split = appendEvent(log, eventOf(sortedFresh()))
    expect(split.events).toHaveLength(log.events.length + 1)
    expect(replay(split).bands[0].subBands).toEqual([
      { tiers: [[2]], unplaced: [] },
      { tiers: [[1]], unplaced: [3, 4] },
      { tiers: [[5]], unplaced: [6] },
    ])
  })

  it('is accepted by the Ranking whatever the dividers and the columns hold', () => {
    const input = sorting(lovedWithTiers(12, 8))
    for (const [divider, edge] of [[0, 0], [1, 8], [0, 8], [1, 0], [0, 3]] as const) {
      const at = moved(withChoices(input, moveDivider(input, divider, edge)), [
        [10, 0],
        [12, 2],
      ])
      expect(() => replay(appendEvent(lovedWithTiers(12, 8), eventOf(at)))).not.toThrow()
    }
  })
})

describe('once the Band is split', () => {
  /** Loved split by the event the columns record, and the Split screen still open on it. */
  function afterSplit(log: DuelLog, moves: readonly (readonly [number, SubBandIndex])[]) {
    const input = moved(sorting(log), moves)
    const view = columnsOf(input)
    const event = view.done.ask ? columnsOf(withChoices(input, view.done.choices)).warning!.event : view.done.event
    return splitView({ ...input, state: replay(appendEvent(log, event)) })
  }

  it('shows the Band as split, whatever the choices still say', () => {
    expect(afterSplit(oversized(), quarters).step).toBe('done')
  })

  it('counts the worst-case Duels left Sub-band by Sub-band: what the columns said the split would save is gone', () => {
    expect(afterSplit(oversized(), quarters)).toMatchObject({ duelsLeft: 538 - 141 })
  })

  it('charts the split Band as a bar per Sub-band and the other Bands as before', () => {
    const view = afterSplit(oversized(), quarters)
    expect(view.step === 'done' && view.bars).toEqual([
      { band: 0, subBand: 0, count: 24, oversized: false },
      { band: 0, subBand: 1, count: 47, oversized: false },
      { band: 0, subBand: 2, count: 24, oversized: false },
      { band: 1, subBand: null, count: 5, oversized: false },
      { band: 2, subBand: null, count: 5, oversized: false },
      { band: 3, subBand: null, count: 5, oversized: false },
      { band: 4, subBand: null, count: 5, oversized: false },
    ])
  })

  it('starts at the first Sub-band with titles to place', () => {
    expect(afterSplit(oversized(), quarters)).toMatchObject({ firstSubBand: 0 })
    // A Best of one title needs no Duel, and neither does an empty one.
    expect(afterSplit(freshLoved(), [[2, 0]])).toMatchObject({ firstSubBand: 1 })
    expect(afterSplit(freshLoved(), [])).toMatchObject({ firstSubBand: 1 })
    expect(afterSplit(freshLoved(), [[1, 0], ...range(2, 4).map((id) => [id, 2] as const)])).toMatchObject({ firstSubBand: 2 })
  })

  it('has no Sub-band to start at when every title of the Band has a place', () => {
    expect(afterSplit(lovedWithTiers(8, 8), [])).toMatchObject({ firstSubBand: null, duelsLeft: 0 })
  })
})
