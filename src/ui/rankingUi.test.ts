// The screen state of the open Ranking: what leaving the Ranking resets, and what its transitions decide (#74), on
// real logs replayed by the engine.
import { describe, expect, it } from 'vitest'
import { appendEvent, replay, startKeepMyScaleLog, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'
import { rankingLogOf } from '../ranking/testRanking.ts'
import {
  NO_RANKING_UI,
  answered,
  boardOpened,
  fixStarted,
  lastCheckLeft,
  leftRanking,
  refineStarted,
  splitSkipped,
  titlesAdded,
  type RankingUi,
} from './rankingUi.ts'

/** Every part set: a split looked at, an offer turned down, the last check continued, a fix and Refine Duels from Preview, a Move sheet open. */
const busy: RankingUi = {
  splitView: { band: 1 },
  skippedSplits: [0, 2],
  lastCheckContinued: true,
  previewFix: { id: 7, verb: 'Re-ranking' },
  refining: true,
  previewMoving: 9,
}

describe('leaving a Ranking', () => {
  it('ends with the one empty state: nothing in progress', () => {
    expect(leftRanking()).toBe(NO_RANKING_UI)
    expect(leftRanking()).toEqual({
      splitView: null,
      skippedSplits: [],
      lastCheckContinued: false,
      previewFix: null,
      refining: false,
      previewMoving: null,
    })
  })

  it('keeps no part of what was in use, as the update App applies to its state', () => {
    // App resets with `setRankingUi(leftRanking)`: React hands the update the state being left.
    const update: (left: RankingUi) => RankingUi = leftRanking
    const parts = Object.keys(busy) as (keyof RankingUi)[]
    for (const part of parts) expect(update({ ...NO_RANKING_UI, [part]: busy[part] })).toBe(NO_RANKING_UI)
    expect(update(busy)).toBe(NO_RANKING_UI)
  })
})

describe('a split offer turned down', () => {
  it('closes the Split screen and is not offered again', () => {
    const state = splitSkipped({ ...NO_RANKING_UI, splitView: { band: 1 }, skippedSplits: [0] }, 1)
    expect(state.splitView).toBeNull()
    expect(state.skippedSplits).toEqual([0, 1])
  })

  it('keeps the rest as it was', () => {
    expect(splitSkipped(busy, 3)).toEqual({ ...busy, splitView: null, skippedSplits: [0, 2, 3] })
  })
})

describe('titles a sync added', () => {
  it('let the skipped split offers show again, and nothing else changes', () => {
    expect(titlesAdded(busy)).toEqual({ ...busy, skippedSplits: [] })
  })
})

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)
const logOf = (ids: number[], ...events: LogEvent[]): DuelLog => plus(startLog({ seed: 42, userId: 7, mediaType: 'ANIME', ids }), ...events)
const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })

/** Answers the Duel asked now: the title with the lower id wins. */
function duel(log: DuelLog): DuelLog {
  const p = replay(log).prompt
  if (p.kind !== 'duel') throw new Error(`unexpected ${p.kind}`)
  return plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: p.a < p.b ? 'a' : 'b' })
}

/** What the engine asks next: the title a Duel places, and whether it is a Refine Duel; else the prompt's kind. */
const asked = (state: RankingState) => {
  const p = state.prompt
  return p.kind === 'duel' ? `duel ${p.a}${p.refine ? ' (refine)' : ''}` : p.kind
}

/** What App does with a transition's change: it goes on top of the latest state. */
const patched = (ui: RankingUi, change: Partial<RankingUi>): RankingUi => ({ ...ui, ...change })

/** `n` Tiers of one title each, ids from `first`, best first. */
const tiers = (first: number, n: number) => Array.from({ length: n }, (_, i) => [first + i])

/** A finished Full Ranking: titles 1, 2 and 3 in that order, all in the top Band. */
const finished = () => rankingLogOf([[[1], [2], [3]], [], [], [], []])

/**
 * A finished Scores Ranking, eight titles in each of the top two Bands, then a settings change that leaves one Refine
 * Duel: title 8's, in the top Band, behind a Band choice.
 */
const oneRefineDuel = () =>
  plus(rankingLogOf([tiers(1, 8), tiers(21, 8), [], [], []], [], 'POINT_10'), {
    type: 'scoring-set',
    format: 'POINT_10',
    settings: { distribution: 'linear', step: 'whole', best: 10, worst: 4 },
  })

/** The same with five titles in each Band and a change that leaves two Refine Duels: title 4's in the top Band, then title 22's in the next. */
const twoRefineDuels = () =>
  plus(rankingLogOf([tiers(1, 5), tiers(21, 5), [], [], []], [], 'POINT_10'), {
    type: 'scoring-set',
    format: 'POINT_10',
    settings: { distribution: 'linear', step: 'whole', best: 10, worst: 8 },
  })

/** Keep My Scale: picked title 1 against Anchors on 8 and 6. */
const keepMyScale = () =>
  startKeepMyScaleLog({ seed: 42, userId: 7, mediaType: 'ANIME', format: 'POINT_10', anchors: [{ id: 101, level: 8 }, { id: 102, level: 6 }], ids: [1] })

/** Answers Anchor Duels until the Closer-to prompt: the picked title beats the Anchor on 6 and loses to the one on 8. */
function toCloserTo(log: DuelLog): DuelLog {
  for (let state = replay(log); state.prompt.kind !== 'closer-to'; state = replay(log)) {
    const p = state.prompt
    if (p.kind !== 'anchor-duel') throw new Error(`unexpected ${p.kind}`)
    log = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: p.b === 102 ? 'a' : 'b' })
  }
  return log
}

/** A Re-rank of `id` started from Preview. */
const fixing = (id: number): RankingUi => ({ ...NO_RANKING_UI, previewFix: { id, verb: 'Re-ranking' } })
/** The Refine Duels started from Preview. */
const refining: RankingUi = { ...NO_RANKING_UI, refining: true }

/** A transition that changes nothing and goes nowhere. */
const NOTHING = { change: {}, goTo: null }

describe('starting a fix from Preview', () => {
  it('changes nothing for a title that needs no Duel (moved into an empty Band), and says so', () => {
    const moved = replay(plus(finished(), { type: 'band-moved', id: 1, band: 3 }))
    expect(asked(moved)).toBe('all-complete')
    expect(fixStarted(moved, 1, 'Moving')).toEqual({ ...NOTHING, noDuelNeeded: true })
  })

  it('remembers the fix while the title has Duels, and the Ranking screen comes next', () => {
    const reranking = replay(plus(finished(), { type: 'rerank-requested', id: 2 }))
    expect(asked(reranking)).toBe('duel 2')
    expect(fixStarted(reranking, 2, 'Re-ranking')).toEqual({ change: { previewFix: { id: 2, verb: 'Re-ranking' } }, goTo: 'ranking', noDuelNeeded: false })
  })

  it('remembers the fix of a title brought back, which has its Band to choose first', () => {
    const back = replay(plus(rankingLogOf([[[1], [2]], [], [], [], []], [9]), { type: 'unforgotten', id: 9 }))
    expect(asked(back)).toBe('rough-sort')
    expect(fixStarted(back, 9, 'Bringing back')).toEqual({ change: { previewFix: { id: 9, verb: 'Bringing back' } }, goTo: 'ranking', noDuelNeeded: false })
  })

  it('on Scores, remembers the fix while the Duel asked is the fixed title’s, and not when only Refine Duels of other titles are left', () => {
    const reranking = replay(plus(twoRefineDuels(), { type: 'rerank-requested', id: 1 }))
    expect(asked(reranking)).toBe('duel 1 (refine)')
    expect(fixStarted(reranking, 1, 'Re-ranking').goTo).toBe('ranking')
    // Moved into an empty Band, title 25 is settled at once; title 4's Refine Duel is still to answer.
    const moved = replay(plus(twoRefineDuels(), { type: 'band-moved', id: 25, band: 4 }))
    expect(asked(moved)).toBe('duel 4 (refine)')
    expect(fixStarted(moved, 25, 'Moving')).toEqual({ ...NOTHING, noDuelNeeded: true })
  })
})

describe('after an answer', () => {
  const nothingEnded = { ...NOTHING, fixEnded: false, refineEnded: false }

  it('changes nothing and goes nowhere with neither a fix nor Refine Duels in progress', () => {
    expect(answered(NO_RANKING_UI, replay(finished()), 'ranking')).toEqual(nothingEnded)
    expect(answered(NO_RANKING_UI, replay(duel(plus(oneRefineDuel(), { type: 'band-selected', band: 0 }))), 'ranking')).toEqual(nothingEnded)
    // Whatever else is in use is none of an answer's business.
    const others: RankingUi = { ...busy, previewFix: null, refining: false }
    expect(answered(others, replay(finished()), 'ranking')).toEqual(nothingEnded)
  })

  it('changes nothing and goes nowhere while the fix has Duels left', () => {
    const oneAnswered = replay(duel(plus(finished(), { type: 'rerank-requested', id: 2 })))
    expect(asked(oneAnswered)).toBe('duel 2')
    expect(answered(fixing(2), oneAnswered, 'ranking')).toEqual(nothingEnded)
  })

  it('changes nothing and goes nowhere while Refine Duels are left', () => {
    const oneAnswered = replay(duel(plus(twoRefineDuels(), { type: 'band-selected', band: 0 })))
    expect(asked(oneAnswered)).toBe('duel 22 (refine)')
    expect(answered(refining, oneAnswered, 'ranking')).toEqual(nothingEnded)
  })

  it('clears a fix that ended and goes to Preview', () => {
    const placed = replay(duel(duel(plus(finished(), { type: 'rerank-requested', id: 2 }))))
    expect(asked(placed)).toBe('all-complete')
    expect(answered(fixing(2), placed, 'ranking')).toEqual({ change: { previewFix: null }, goTo: 'preview', fixEnded: true, refineEnded: false })
  })

  it('clears a fix that ended with Preview already showing, and has no destination', () => {
    const placed = replay(duel(duel(plus(finished(), { type: 'rerank-requested', id: 2 }))))
    expect(answered(fixing(2), placed, 'preview')).toEqual({ change: { previewFix: null }, goTo: null, fixEnded: true, refineEnded: false })
  })

  it('counts an Undo during a fix as the fix being done', () => {
    const undone = replay(plus(finished(), { type: 'rerank-requested', id: 2 }, { type: 'undo' }))
    expect(answered(fixing(2), undone, 'ranking')).toEqual({ change: { previewFix: null }, goTo: 'preview', fixEnded: true, refineEnded: false })
  })

  it('ends a fix on Scores once only Refine Duels of other titles are left, and those go on', () => {
    const placed = replay(duel(plus(twoRefineDuels(), { type: 'rerank-requested', id: 1 })))
    expect(asked(placed)).toBe('duel 4 (refine)')
    const after = answered({ ...fixing(1), refining: true }, placed, 'ranking')
    expect(after).toEqual({ change: { previewFix: null }, goTo: 'preview', fixEnded: true, refineEnded: false })
    expect(after.change).not.toHaveProperty('refining')
  })

  it('clears the Refine Duels once they are all answered, goes to Preview and says so', () => {
    const settled = replay(duel(plus(oneRefineDuel(), { type: 'band-selected', band: 0 })))
    expect(asked(settled)).toBe('all-complete')
    expect(answered(refining, settled, 'ranking')).toEqual({ change: { refining: false }, goTo: 'preview', fixEnded: false, refineEnded: true })
  })

  it('says the Refine Duels ended with Preview already showing, and has no destination', () => {
    // Left with Back before they were all answered; then the one unsettled title is settled some other way.
    const settled = replay(plus(oneRefineDuel(), { type: 'forgotten', id: 8 }))
    expect(asked(settled)).toBe('all-complete')
    expect(answered(refining, settled, 'preview')).toEqual({ change: { refining: false }, goTo: null, fixEnded: false, refineEnded: true })
  })

  it('ends the Duels of a Keep My Scale Ranking started from Preview the same way', () => {
    const closerTo = toCloserTo(keepMyScale())
    expect(answered(refining, replay(closerTo), 'ranking')).toEqual(nothingEnded)
    const settled = replay(plus(closerTo, { type: 'closer-to-answered', id: 1, level: 8 }))
    expect(asked(settled)).toBe('all-complete')
    expect(answered(refining, settled, 'ranking')).toEqual({ change: { refining: false }, goTo: 'preview', fixEnded: false, refineEnded: true })
  })

  it('gives one destination and clears both when a fix and the Refine Duels end on the same answer', () => {
    // Title 8 has the only Refine Duel; Re-ranked from Preview, its last Duel settles every score.
    const lastDuel = duel(plus(oneRefineDuel(), { type: 'rerank-requested', id: 8 }))
    const both = { ...fixing(8), refining: true }
    expect(asked(replay(lastDuel))).toBe('duel 8 (refine)')
    expect(answered(both, replay(lastDuel), 'ranking')).toEqual(nothingEnded)
    const settled = replay(duel(lastDuel))
    expect(asked(settled)).toBe('all-complete')
    expect(answered(both, settled, 'ranking')).toEqual({ change: { previewFix: null, refining: false }, goTo: 'preview', fixEnded: true, refineEnded: true })
  })

  it('answers only with the fields that change, so whatever else is in use stays', () => {
    const settled = replay(duel(duel(plus(oneRefineDuel(), { type: 'rerank-requested', id: 8 }))))
    const { change } = answered({ ...busy, previewFix: { id: 8, verb: 'Re-ranking' } }, settled, 'ranking')
    expect(Object.keys(change).sort()).toEqual(['previewFix', 'refining'])
    expect(patched(busy, change)).toEqual({ ...busy, previewFix: null, refining: false })
  })
})

describe('starting the Refine Duels from Preview', () => {
  const nothing = { ...NOTHING, bandFirst: null }

  it('does nothing without a Duel to go to', () => {
    expect(refineStarted(null)).toEqual(nothing)
    expect(refineStarted(replay(finished()))).toEqual(nothing)
    expect(refineStarted(replay(logOf([1, 2], assign(1, 0))))).toEqual(nothing)
  })

  it('sets refining and names the Band when a Band choice comes first', () => {
    expect(refineStarted(replay(oneRefineDuel()))).toEqual({ change: { refining: true }, goTo: null, bandFirst: 0 })
    const topBandDone = replay(duel(plus(twoRefineDuels(), { type: 'band-selected', band: 0 })))
    expect(refineStarted(topBandDone)).toEqual({ change: { refining: true }, goTo: null, bandFirst: 1 })
  })

  it('sets refining and goes to the Ranking screen when the Band is chosen already', () => {
    const chosen = replay(plus(oneRefineDuel(), { type: 'band-selected', band: 0 }))
    expect(refineStarted(chosen)).toEqual({ change: { refining: true }, goTo: 'ranking', bandFirst: null })
  })

  it('goes to the Ranking screen under Keep My Scale, which has no Band to choose', () => {
    const toRanking = { change: { refining: true }, goTo: 'ranking', bandFirst: null }
    expect(refineStarted(replay(keepMyScale()))).toEqual(toRanking)
    expect(refineStarted(replay(toCloserTo(keepMyScale())))).toEqual(toRanking)
  })

  it('leaves refining set when the Band choice is answered in the same tick', () => {
    // App reaches the answer through the Band choice before it renders again: the answer sees the state
    // "Go to Duels →" was pressed on, where refining is not set yet.
    const pressedOn = NO_RANKING_UI
    const log = oneRefineDuel()
    const started = refineStarted(replay(log))
    const chosen = replay(plus(log, { type: 'band-selected', band: started.bandFirst! }))
    const after = answered(pressedOn, chosen, 'preview')
    expect(after.change).not.toHaveProperty('refining')
    expect(patched(patched(pressedOn, started.change), after.change).refining).toBe(true)
  })
})

describe('opening the Board', () => {
  it('goes to the Board during Rough Sort', () => {
    expect(boardOpened(replay(logOf([1, 2], assign(1, 0))))).toEqual({ change: {}, goTo: 'board' })
  })

  it('shows the last check again after Rough Sort', () => {
    const sorted = replay(logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0)))
    expect(sorted.board.open).toBe(true)
    expect(boardOpened(sorted)).toEqual({ change: { lastCheckContinued: false }, goTo: null })
  })

  it('does nothing with the Board closed: after the first Duel answer, under Keep My Scale, without a Ranking', () => {
    const answeredOnce = replay(duel(logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0))))
    expect(answeredOnce.board.open).toBe(false)
    expect(boardOpened(answeredOnce)).toEqual(NOTHING)
    expect(boardOpened(replay(keepMyScale()))).toEqual(NOTHING)
    expect(boardOpened(null)).toEqual(NOTHING)
  })
})

describe('Continue on the last check', () => {
  const sorted = () => replay(logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0)))

  it('goes to the Band choice when a Duel is next', () => {
    expect(sorted().prompt.kind).toBe('duel')
    expect(lastCheckLeft(sorted(), 'ranking')).toEqual({ change: { lastCheckContinued: true }, goTo: 'bands' })
  })

  it('has no destination when the Band choice is showing already', () => {
    expect(lastCheckLeft(sorted(), 'bands')).toEqual({ change: { lastCheckContinued: true }, goTo: null })
  })

  it('has no destination when no Duel is next: a Band of one title is finished as it is', () => {
    const alone = replay(logOf([1], assign(1, 0)))
    expect(asked(alone)).toBe('all-complete')
    expect(lastCheckLeft(alone, 'ranking')).toEqual({ change: { lastCheckContinued: true }, goTo: null })
  })
})
