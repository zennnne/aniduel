import { describe, expect, it } from 'vitest'
import { importPlan, isTicked, previewRows } from './preview.ts'
import { score } from './scoring.ts'
import { rankingOf } from './testRanking.ts'

const linear = (best: number, worst: number) => ({ distribution: 'linear' as const, best, worst })

describe('Preview rows', () => {
  // 10 point, 10..4 over three titles → 10, 7, 4.
  const state = rankingOf([[[1]], [[2], [3]]], [9])
  const scores = score(state, 'POINT_10', linear(10, 4))

  it('shows each ranked Pool title with its old and new score, in Ranking order', () => {
    const pool = new Map([[1, 100], [2, 0], [3, 47], [9, 80]])
    expect(previewRows(state, scores, pool, 'POINT_10')).toEqual([
      { id: 1, band: 0, level: 10, scoreRaw: 100, oldScore100: 100, oldLevel: 10, changed: false },
      { id: 2, band: 1, level: 7, scoreRaw: 70, oldScore100: 0, oldLevel: null, changed: true },
      { id: 3, band: 1, level: 4, scoreRaw: 40, oldScore100: 47, oldLevel: 4, changed: false },
    ])
  })

  it('compares old and new at the Score Format level, not the raw score', () => {
    // Raw 79 shows as 7 on 10 point, so a new 7 (raw 70) is no change; on 100 point 79 → 70 would be.
    const rows = previewRows(state, scores, new Map([[1, 100], [2, 79], [3, 40]]), 'POINT_10')
    expect(rows.map((r) => r.changed)).toEqual([false, false, false])
  })

  it('leaves out ranked titles that are no longer in the Pool', () => {
    const rows = previewRows(state, scores, new Map([[1, 100], [3, 40]]), 'POINT_10')
    expect(rows.map((r) => r.id)).toEqual([1, 3])
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
