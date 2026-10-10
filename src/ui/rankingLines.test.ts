// The Ranking as lines on the Band choice, Complete and sidebar (#25, #27): by Tier on Full Ranking, by score level
// with names sorted on Scores.
import { describe, expect, it } from 'vitest'
import { appendEvent, replay, startLog, startNewTitlesLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'
import { rankingOf } from '../ranking/testRanking.ts'
import { newTitlesLines, rankingLines } from './rankingLines.ts'

const NAMES: Record<number, string> = { 1: 'Zeta', 2: 'alpha', 3: 'Mu', 4: 'beta 10', 5: 'beta 9', 6: 'Ébène', 7: 'Solo' }
const name = (id: number) => NAMES[id]

/**
 * A Scores Ranking played to the end: `bands[b]` lists Band b's titles best first, all different. Scored linearly
 * from 10 down to 9 on 10 points, so the top half of the Ranking gets 10 and the bottom half 9.
 */
function scoresRanking(bands: number[][]): RankingState {
  const ids = bands.flat()
  const value = new Map(ids.map((id, i) => [id, -i]))
  let log: DuelLog = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids, scoreFormat: 'POINT_10' })
  const add = (e: LogEvent) => (log = { ...log, events: [...log.events, e] })
  add({ type: 'scoring-set', format: 'POINT_10', settings: { distribution: 'linear', step: 'whole', best: 10, worst: 9 } })
  bands.forEach((titles, band) => titles.forEach((id) => add({ type: 'band-assigned', id, band: band as BandIndex })))
  for (let s = replay(log); s.prompt.kind !== 'all-complete'; s = replay(log)) {
    const p = s.prompt
    if (p.kind !== 'duel') throw new Error(`unexpected ${p.kind}`)
    add({ type: 'duel-answered', a: p.a, b: p.b, result: value.get(p.a)! > value.get(p.b)! ? 'a' : 'b' })
  }
  return replay(log)
}

describe('ranking lines on Scores', () => {
  it('group a Band by score level, best first, each level sorted by name', () => {
    const state = scoresRanking([[1, 2, 3, 4, 5, 6]])
    expect(rankingLines(state, 0, name)).toEqual([
      // Case and accents are ignored, numbers go in numeric order.
      { key: 10, mark: '10', ids: [2, 3, 1], note: 'same score · no order' },
      { key: 9, mark: '9', ids: [5, 4, 6], note: 'same score · no order' },
    ])
  })

  it('give a title alone on its level a line with no note, and an empty Band no lines', () => {
    const state = scoresRanking([[1, 2, 3], [], [], [], [7]])
    expect(rankingLines(state, 4, name)).toEqual([{ key: 9, mark: '9', ids: [7], note: null }])
    expect(rankingLines(state, 2, name)).toEqual([])
  })
})

describe('ranking lines on Full Ranking', () => {
  it('stay one line per Tier, numbered by place in the whole Ranking, titles in the order they joined', () => {
    const state = rankingOf([[[1], [3, 2]], [], [[6], [5]], [], []])
    expect(rankingLines(state, 0, name)).toEqual([
      { key: 1, mark: '1', ids: [1], note: null },
      { key: 3, mark: '2', ids: [3, 2], note: 'Tier · same score' },
    ])
    expect(rankingLines(state, 2, name)).toEqual([
      { key: 6, mark: '3', ids: [6], note: null },
      { key: 5, mark: '4', ids: [5], note: null },
    ])
  })
})

describe('score lines on Score New Titles', () => {
  // Anchors on 9 (two), 8 and 7; new titles 1 and 2 tie an Anchor on 9, title 3 one on 7, title 4 is not settled.
  const anchors = [9, 9, 8, 7].map((level, i) => ({ id: 101 + i, level }))
  const truth: Record<number, number> = { 1: 9, 2: 9, 3: 7 }
  let log: DuelLog = startNewTitlesLog({ seed: 5, userId: 7, mediaType: 'ANIME', format: 'POINT_10', anchors, ids: [1, 2, 3, 4] })
  for (let s = replay(log); s.prompt.kind === 'anchor-duel' && s.prompt.a !== 4; s = replay(log)) {
    const { a, b } = s.prompt
    const theirs = anchors.find((x) => x.id === b)!.level
    log = appendEvent(log, { type: 'duel-answered', a, b, result: truth[a] === theirs ? 'tie' : truth[a] > theirs ? 'a' : 'b' })
  }
  const state = replay(log)

  it('has one line per Anchor score, best first, with its Anchor count and its settled new titles by name', () => {
    expect(newTitlesLines(state, name)).toEqual([
      { level: 9, mark: '9', anchors: 2, ids: [2, 1] },
      { level: 8, mark: '8', anchors: 1, ids: [] },
      { level: 7, mark: '7', anchors: 1, ids: [3] },
    ])
  })

  it('adds the score one step past the extreme Anchors only once a title landed on it', () => {
    let above: DuelLog = startNewTitlesLog({ seed: 5, userId: 7, mediaType: 'ANIME', format: 'POINT_10', anchors, ids: [5] })
    for (let s = replay(above); s.prompt.kind === 'anchor-duel'; s = replay(above)) {
      above = appendEvent(above, { type: 'duel-answered', a: s.prompt.a, b: s.prompt.b, result: 'a' })
    }
    expect(newTitlesLines(replay(above), name)).toEqual([
      { level: 10, mark: '10', anchors: 0, ids: [5] },
      { level: 9, mark: '9', anchors: 2, ids: [] },
      { level: 8, mark: '8', anchors: 1, ids: [] },
      { level: 7, mark: '7', anchors: 1, ids: [] },
    ])
  })
})
