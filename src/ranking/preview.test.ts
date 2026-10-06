import { describe, expect, it } from 'vitest'
import { appendEvent, replay, startLog, type DuelLog, type LogEvent } from './engine.ts'
import { importPlan, isTicked, previewRows, settledRows } from './preview.ts'
import { defaultSettings, score } from './scoring.ts'
import { rankingOf } from './testRanking.ts'

const linear = (best: number, worst: number) => ({ distribution: 'linear' as const, step: 'fine' as const, best, worst })

describe('Preview rows', () => {
  // 10 point, 10..4 over three titles → 10, 7, 4.
  const state = rankingOf([[[1]], [[2], [3]]], [9])
  const scores = score(state, 'POINT_10', linear(10, 4))

  it('shows each ranked Pool title with its old and new score, in Ranking order', () => {
    const pool = new Map([[1, 100], [2, 0], [3, 47], [9, 80]])
    expect(previewRows(state, scores, pool, 'POINT_10')).toEqual([
      { id: 1, band: 0, settled: true, level: 10, scoreRaw: 100, oldScore100: 100, oldLevel: 10, changed: false },
      { id: 2, band: 1, settled: true, level: 7, scoreRaw: 70, oldScore100: 0, oldLevel: null, changed: true },
      { id: 3, band: 1, settled: true, level: 4, scoreRaw: 40, oldScore100: 47, oldLevel: 4, changed: false },
    ])
  })

  it('compares old and new at the Score Format level, not the raw score', () => {
    // Raw 79 shows as 7 on 10 point, so a new 7 (raw 70) is no change; on 100 point 79 → 70 would be.
    const rows = settledRows(previewRows(state, scores, new Map([[1, 100], [2, 79], [3, 40]]), 'POINT_10'))
    expect(rows.map((r) => r.changed)).toEqual([false, false, false])
  })

  it('leaves out ranked titles that are no longer in the Pool', () => {
    const rows = previewRows(state, scores, new Map([[1, 100], [3, 40]]), 'POINT_10')
    expect(rows.map((r) => r.id)).toEqual([1, 3])
  })
})

describe('Preview rows on Scores', () => {
  // Ten titles in two Bands on 3 smileys, 3..1 (defaults): Duels stop once each title's smiley is settled.
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const value = (id: number) => 100 - id
  let log: DuelLog = startLog({ seed: 4, userId: 7, mediaType: 'ANIME', ids, scoreFormat: 'POINT_3' })
  const add = (event: LogEvent) => (log = appendEvent(log, event))
  for (const id of ids) add({ type: 'band-assigned', id, band: id <= 4 ? 0 : 1 })
  for (let s = replay(log); s.prompt.kind === 'duel'; s = replay(log)) {
    const { a, b } = s.prompt
    add({ type: 'duel-answered', a, b, result: value(a) > value(b) ? 'a' : 'b' })
  }
  const state = replay(log)
  const settings = defaultSettings('POINT_3', 'whole')

  it('shows every settled title, including those never given an exact place, best level first', () => {
    expect(state.prompt.kind).toBe('all-complete')
    const rows = settledRows(previewRows(state, score(state, 'POINT_3', settings), new Map(ids.map((id) => [id, 0])), 'POINT_3'))
    expect(rows.map((r) => r.id).sort((x, y) => x - y)).toEqual(ids)
    // Linear 3..1 over ten positions: 3, 2.78, 2.56 | 2.33 … 1.67 | 1.44, 1.22, 1.
    expect(rows.map((r) => r.level)).toEqual([3, 3, 3, 2, 2, 2, 2, 1, 1, 1])
    expect(new Map(rows.map((r) => [r.id, r.level]))).toEqual(
      new Map([[1, 3], [2, 3], [3, 3], [4, 2], [5, 2], [6, 2], [7, 2], [8, 1], [9, 1], [10, 1]]),
    )
  })

  it('groups rows by level, best first, and sorts them by name inside each level', () => {
    const names = new Map([[1, 'Mushishi'], [2, 'Frieren'], [3, 'odd Taxi'], [4, 'Bebop'], [5, 'Akira'], [6, 'Zipang'], [7, 'Clannad'], [8, 'Yuru Camp'], [9, 'Haikyu'], [10, 'Aria']])
    const all = previewRows(state, score(state, 'POINT_3', settings), new Map(ids.map((id) => [id, 0])), 'POINT_3', (id) => names.get(id)!)
    const rows = settledRows(all)
    expect(rows).toHaveLength(all.length)
    expect(rows.map((r) => [r.level, names.get(r.id)])).toEqual([
      [3, 'Frieren'], [3, 'Mushishi'], [3, 'odd Taxi'],
      [2, 'Akira'], [2, 'Bebop'], [2, 'Clannad'], [2, 'Zipang'],
      [1, 'Aria'], [1, 'Haikyu'], [1, 'Yuru Camp'],
    ])
  })

  it('flags titles unsettled by a settings change, and never plans them even when ticked', () => {
    // Bell 3..2 moves the boundaries away from where the Duels settled them.
    const changed = { ...settings, distribution: 'bell' as const, worst: 2 }
    const rows = previewRows(state, score(state, 'POINT_3', changed), new Map(ids.map((id) => [id, 0])), 'POINT_3')
    const open = rows.filter((r) => !r.settled).map((r) => r.id)
    expect(rows).toHaveLength(ids.length)
    expect(open.length).toBeGreaterThan(0)
    expect(rows.slice(-open.length).every((r) => !r.settled)).toBe(true)
    const planned = importPlan(rows, new Map(ids.map((id) => [id, true]))).map((w) => w.mediaId)
    expect(planned.sort((x, y) => x - y)).toEqual(ids.filter((id) => !open.includes(id)))
  })
})

describe('Unsettled rows on Scores', () => {
  // Same ten titles, but only the first two Duels answered: most levels are still open.
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const value = (id: number) => 100 - id
  let log: DuelLog = startLog({ seed: 4, userId: 7, mediaType: 'ANIME', ids, scoreFormat: 'POINT_3' })
  const add = (event: LogEvent) => (log = appendEvent(log, event))
  for (const id of ids) add({ type: 'band-assigned', id, band: id <= 4 ? 0 : 1 })
  for (let s = replay(log), n = 0; s.prompt.kind === 'duel' && n < 2; s = replay(log), n++) {
    const { a, b } = s.prompt
    add({ type: 'duel-answered', a, b, result: value(a) > value(b) ? 'a' : 'b' })
  }
  const state = replay(log)
  const settings = defaultSettings('POINT_3', 'whole')
  const rows = previewRows(state, score(state, 'POINT_3', settings), new Map(ids.map((id) => [id, 0])), 'POINT_3')
  const unsettled = rows.filter((r) => !r.settled).map((r) => r.id)

  it('shows every title in a Band, flagging those whose level is not settled yet', () => {
    expect(rows.map((r) => r.id).sort((x, y) => x - y)).toEqual(ids)
    expect(unsettled.length).toBeGreaterThan(0)
    expect(new Set(unsettled)).toEqual(new Set(ids.filter((id) => !state.standing!.settled.has(id))))
  })

  it('gives an unsettled row the levels it can still get, best first, and no new score', () => {
    for (const row of rows) {
      if (row.settled) continue
      expect(row.levels.length).toBeGreaterThan(1)
      expect([...row.levels].sort((x, y) => y - x)).toEqual(row.levels)
      expect(row).not.toHaveProperty('scoreRaw')
    }
  })

  it('never ticks or plans an unsettled row, whatever the tick overrides say', () => {
    const overrides = new Map(ids.map((id) => [id, true]))
    expect(rows.filter((r) => !r.settled).some((r) => isTicked(r, overrides))).toBe(false)
    const planned = importPlan(rows, overrides).map((w) => w.mediaId)
    expect(planned.length).toBe(ids.length - unsettled.length)
    expect(planned.filter((id) => unsettled.includes(id))).toEqual([])
  })
})

describe('Import selection', () => {
  const state = rankingOf([[[1], [2], [3]]], [9])
  const rows = previewRows(state, score(state, 'POINT_10', linear(10, 4)), new Map([[1, 100], [2, 0], [3, 90], [9, 50]]), 'POINT_10')

  it('ticks only titles whose score changes, by default', () => {
    expect(rows.map((r) => isTicked(r, new Map()))).toEqual([false, true, true])
  })

  it('lets the user untick a changing title or tick an unchanged one', () => {
    const overrides = new Map([[1, true], [3, false]])
    expect(rows.map((r) => isTicked(r, overrides))).toEqual([true, true, false])
  })

  it('plans one write per ticked title with its exact scoreRaw and the old score it replaces', () => {
    expect(importPlan(rows, new Map())).toEqual([
      { mediaId: 2, scoreRaw: 70, oldScore100: 0 },
      { mediaId: 3, scoreRaw: 40, oldScore100: 90 },
    ])
  })

  it('never plans a Forgotten title, even if ticked', () => {
    expect(importPlan(rows, new Map([[9, true]])).map((w) => w.mediaId)).toEqual([2, 3])
  })
})
