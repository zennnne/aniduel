import { describe, expect, it } from 'vitest'
import { startLog, type DuelLog } from '../ranking/engine.ts'
import type { SavedScoring } from '../ranking/scoring.ts'
import { planHash, resumeImport } from './plan.ts'
import { newImport, type ImportState } from './importState.ts'

const log: DuelLog = startLog({ seed: 1, userId: 1, mediaType: 'ANIME', ids: [1, 2, 3] })
const scoring: SavedScoring = { format: 'POINT_100', settings: { distribution: 'linear', step: 'fine', best: 95, worst: 30 } }

describe('Import plan hash', () => {
  it('is the same for the same Duel log and scoring settings', () => {
    expect(planHash(structuredClone(log), structuredClone(scoring))).toBe(planHash(log, scoring))
  })

  it('changes when the Duel log gets a new event', () => {
    const more: DuelLog = { ...log, events: [...log.events, { type: 'band-assigned', id: 1, band: 0 }] }
    expect(planHash(more, scoring)).not.toBe(planHash(log, scoring))
  })

  it('changes when the scoring settings change', () => {
    expect(planHash(log, { ...scoring, settings: { ...scoring.settings, distribution: 'bell' } })).not.toBe(planHash(log, scoring))
  })

  // A title unticked after the Import was cut off must not be written when it resumes (#1 US52).
  it('changes when a tick changes, so a resumed Import is recalculated with the new ticks', () => {
    const unticked = planHash(log, scoring, new Map([[2, false]]))
    expect(unticked).not.toBe(planHash(log, scoring))
    expect(planHash(log, scoring, new Map([[2, true]]))).not.toBe(unticked)
  })

  it('does not depend on the order the ticks were changed in', () => {
    expect(planHash(log, scoring, new Map([[1, false], [2, true]]))).toBe(planHash(log, scoring, new Map([[2, true], [1, false]])))
  })

  it('is the same with no tick changes as before ticks were saved', () => {
    expect(planHash(log, scoring, new Map())).toBe(planHash(log, scoring))
  })
})

describe('Resuming an Import', () => {
  const saved: ImportState = {
    ...newImport(
      [
        { mediaId: 1, scoreRaw: 90, oldScore100: 0 },
        { mediaId: 2, scoreRaw: 70, oldScore100: 50 },
        { mediaId: 3, scoreRaw: 30, oldScore100: 80 },
      ],
      { hash: 'old', format: 'POINT_100' },
    ),
  }
  saved.writes[0].status = 'done'

  it('carries on with the saved plan when nothing changed', () => {
    const plan = () => {
      throw new Error('not recalculated')
    }
    expect(resumeImport(saved, { hash: 'old', format: 'POINT_100', plan })).toEqual({ kind: 'continue', state: saved })
  })

  it('recalculates the plan and asks again when the hash changed', () => {
    const fresh = [
      { mediaId: 2, scoreRaw: 60, oldScore100: 50 },
      { mediaId: 3, scoreRaw: 30, oldScore100: 80 },
    ]

    const result = resumeImport(saved, { hash: 'new', format: 'POINT_100', plan: () => fresh })

    expect(result.kind).toBe('confirm-again')
    if (result.kind !== 'confirm-again') return
    expect(result.writtenBefore).toBe(1)
    expect(result.state.hash).toBe('new')
    expect(result.state.writes.map((w) => [w.mediaId, w.scoreRaw, w.status])).toEqual([
      [2, 60, 'pending'],
      [3, 30, 'pending'],
    ])
  })

  it('takes a title written by the old plan as its old score, so it is not mistaken for a change made on AniList', () => {
    // The list was loaded before the first Import, so the new plan still has title 1's score from before it.
    const fresh = [{ mediaId: 1, scoreRaw: 85, oldScore100: 0 }]

    const result = resumeImport(saved, { hash: 'new', format: 'POINT_100', plan: () => fresh })

    expect(result.kind === 'confirm-again' && result.state.writes[0]).toMatchObject({ mediaId: 1, scoreRaw: 85, oldScore100: 90 })
  })

  it('drops the plan when the Score Format changed', () => {
    expect(resumeImport(saved, { hash: 'old', format: 'POINT_10', plan: () => [] })).toEqual({ kind: 'dropped' })
  })
})
