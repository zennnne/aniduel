// The menu's Board entry (#34): only while the Board is open, i.e. before the first Duel answer.
import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from '../../ranking/engine.ts'
import { buildMenuItems, type MenuActions } from './buildMenuItems.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })
const duel: LogEvent = { type: 'duel-answered', a: 2, b: 1, result: 'a' }

const noop = () => {}
const actions: MenuActions = {
  switchMediaType: noop,
  changeStatuses: noop,
  saveBackup: noop,
  chooseBand: noop,
  splitBand: noop,
  openBoard: noop,
  restore: noop,
  startOver: noop,
  toggleTheme: noop,
  logout: noop,
  switchSortGoal: noop,
}

const ids = (log: DuelLog) =>
  buildMenuItems(
    { mediaType: 'ANIME', statuses: ['COMPLETED'], hasLog: true, hasProgress: true, ranking: replay(log), choosingBand: false, splitOffers: [] },
    actions,
  ).map((item) => item.id)

describe('the Board in the menu', () => {
  it('is offered during Rough Sort and after it, before any Duel answer', () => {
    expect(ids(logOf([1, 2], assign(1, 0)))).toContain('board')
    expect(ids(logOf([1, 2], assign(1, 0), assign(2, 0)))).toContain('board')
  })

  it('is hidden once a Duel is answered, and back when Undo removes it', () => {
    const answered = logOf([1, 2], assign(1, 0), assign(2, 0), duel)
    expect(ids(answered)).not.toContain('board')
    expect(ids({ ...answered, events: [...answered.events, { type: 'undo' }] })).toContain('board')
  })
})

// #28: the Sort Goal switch, in This Ranking.
describe('the Sort Goal switch in the menu', () => {
  const items = (log: DuelLog | null, switchSortGoal: MenuActions['switchSortGoal'] = noop) =>
    buildMenuItems(
      { mediaType: 'ANIME', statuses: ['COMPLETED'], hasLog: Boolean(log), hasProgress: Boolean(log), ranking: log && replay(log), choosingBand: false, splitOffers: [] },
      { ...actions, switchSortGoal },
    )
  const big = Array.from({ length: 200 }, (_, i) => i + 1)

  it('offers Full Ranking on Scores, with about how many more Duels it takes', () => {
    const chosen: string[] = []
    const scores = startLog({ ...header, ids: big, scoreFormat: 'POINT_10_DECIMAL' })
    const item = items(scores, (goal) => chosen.push(goal)).find((i) => i.id === 'sort-goal')!
    expect(item.group).toBe('This Ranking')
    expect(item.title).toBe('Switch to Full Ranking')
    expect(item.description).toMatch(/^Every title gets its own place · about \+\d+ Duels$/)
    item.run()
    expect(chosen).toEqual(['full-ranking'])
  })

  it('offers Scores on Full Ranking, also on an older Ranking without any Sort Goal', () => {
    const chosen: string[] = []
    const item = items(logOf([1, 2]), (goal) => chosen.push(goal)).find((i) => i.id === 'sort-goal')!
    expect(item.title).toBe('Switch to Scores')
    expect(item.description).toBe('Stop once every score is settled · fewer Duels')
    item.run()
    expect(chosen).toEqual(['scores'])
  })

  it('is not offered without a Ranking', () => {
    expect(items(null).map((i) => i.id)).not.toContain('sort-goal')
  })
})

// US29: the split item counts the titles that still need Duels.
describe('the split offer in the menu', () => {
  const splitItem = (log: DuelLog) =>
    buildMenuItems(
      { mediaType: 'ANIME', statuses: ['COMPLETED'], hasLog: true, hasProgress: true, ranking: replay(log), choosingBand: false, splitOffers: [4] },
      actions,
    ).find((i) => i.id === 'split-band-4')!
  const hated = Array.from({ length: 100 }, (_, i) => i + 1)

  it('counts titles without a place on Full Ranking', () => {
    // The first title of the Band has a place once Rough Sort is done.
    expect(splitItem(logOf(hated, ...hated.map((id) => assign(id, 4)))).description).toBe(
      '99 titles without a place: Best / Middle / Lowest cuts the Duels',
    )
  })

  it('counts titles not settled yet on Scores', () => {
    // 100 titles in one Band span every level, so none is settled, the placed one included.
    const log = startLog({ ...header, ids: hated, scoreFormat: 'POINT_3' })
    expect(splitItem({ ...log, events: [...log.events, ...hated.map((id) => assign(id, 4))] }).description).toBe(
      '100 titles not settled: Best / Middle / Lowest cuts the Duels',
    )
  })
})
