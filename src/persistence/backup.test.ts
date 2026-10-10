import { describe, expect, it } from 'vitest'
import { appendEvent, replay, startLog, startNewTitlesLog, type DuelLog } from '../ranking/engine.ts'
import { score, scoringFor } from '../ranking/scoring.ts'
import { createBackup, readBackup, restoreBackup } from './backup.ts'
import {
  loadDuelLog,
  loadPoolSettings,
  loadScoringSettings,
  saveDuelLog,
  savePoolSettings,
  saveScoringSettings,
} from './progress.ts'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

const anime = { userId: 7, mediaType: 'ANIME' as const }
const now = new Date('2026-10-05T12:00:00Z')

function someProgress(): DuelLog {
  const log = startLog({ ...anime, seed: 42, ids: [1, 2, 3, 4] })
  log.events.push(
    { type: 'band-assigned', id: 1, band: 0 },
    { type: 'forgotten', id: 2 },
    { type: 'band-assigned', id: 3, band: 4 },
    { type: 'undo' },
    { type: 'band-assigned', id: 3, band: 2 },
  )
  return log
}

describe('Backup and Restore', () => {
  it('a Backup restored in another browser replays to the same Ranking, with the same settings', () => {
    const here = memoryStorage()
    saveDuelLog(here, someProgress())
    savePoolSettings(here, anime, { statuses: ['COMPLETED', 'DROPPED'] })

    const file = createBackup(here, { ...anime, userName: 'zen' }, now)!
    const elsewhere = memoryStorage()
    restoreBackup(elsewhere, readBackup(file.json, anime))

    const restored = loadDuelLog(elsewhere, anime)!
    expect(replay(restored)).toEqual(replay(someProgress()))
    expect(loadPoolSettings(elsewhere, anime)).toEqual({ statuses: ['COMPLETED', 'DROPPED'] })
  })

  it('carries the scoring settings too, and still restores a Backup made before they existed', () => {
    const scoring = { format: 'POINT_5' as const, settings: { distribution: 'bell' as const, step: 'fine' as const, best: 5, worst: 2 } }
    const here = memoryStorage()
    saveDuelLog(here, someProgress())
    saveScoringSettings(here, anime, scoring)
    const file = createBackup(here, { ...anime, userName: 'zen' }, now)!
    const elsewhere = memoryStorage()
    restoreBackup(elsewhere, readBackup(file.json, anime))
    expect(loadScoringSettings(elsewhere, anime)).toEqual(scoring)

    const old = JSON.parse(file.json) as { settings: Record<string, unknown> }
    delete old.settings.scoring
    expect(readBackup(JSON.stringify(old), anime).settings.scoring).toBeNull()
  })

  it('settings changed on Preview travel in the Duel log: a reload and a Restore elsewhere give the same scores', () => {
    // Linear 9..4 over three titles: 9, 6.5 (rounds to 7), 4. The defaults would give 10, 6.5 → 7, 3.
    // A new log is on Scores, which always uses the whole Score Step (on 10 point, its only one).
    const chosen = { distribution: 'linear' as const, step: 'whole' as const, best: 9, worst: 4 }
    let log = startLog({ ...anime, seed: 42, ids: [1, 2, 3], scoreFormat: 'POINT_10' })
    for (const id of [1, 2, 3]) log = appendEvent(log, { type: 'band-assigned', id, band: id === 3 ? 4 : 0 })
    log = appendEvent(log, { type: 'duel-answered', a: 2, b: 1, result: 'b' })
    log = appendEvent(log, { type: 'scoring-set', format: 'POINT_10', settings: chosen })
    const here = memoryStorage()
    saveDuelLog(here, log)
    const scoresIn = (storage: Storage) => {
      const state = replay(loadDuelLog(storage, anime)!)
      const { settings } = scoringFor(state, loadScoringSettings(storage, anime), 'POINT_10')
      return { settings, levels: [...score(state, 'POINT_10', settings).titles].map(([id, s]) => [id, s.level]) }
    }
    expect(scoresIn(here)).toEqual({ settings: chosen, levels: [[1, 9], [2, 7], [3, 4]] })

    const elsewhere = memoryStorage()
    saveScoringSettings(elsewhere, anime, { format: 'POINT_10', settings: { ...chosen, distribution: 'bell', best: 10, worst: 1 } })
    restoreBackup(elsewhere, readBackup(createBackup(here, { ...anime, userName: 'zen' }, now)!.json, anime))
    expect(scoresIn(elsewhere)).toEqual(scoresIn(here))
  })

  it('a Score New Titles Ranking restores to the same Anchors, answers, Forgotten titles and prompt', () => {
    const anchors = [9, 8, 8, 7, 6].map((level, i) => ({ id: 101 + i, level }))
    let log = startNewTitlesLog({ ...anime, seed: 42, format: 'POINT_10', anchors, ids: [1, 2, 3] })
    const first = replay(log).prompt
    if (first.kind !== 'anchor-duel') throw new Error(first.kind)
    log = appendEvent(log, { type: 'duel-answered', a: first.a, b: first.b, result: 'a' })
    log = appendEvent(log, { type: 'forgotten', id: 3 })
    const next = replay(log).prompt
    if (next.kind !== 'anchor-duel') throw new Error(next.kind)
    log = appendEvent(log, { type: 'forgotten', id: next.b })

    const here = memoryStorage()
    saveDuelLog(here, log)
    const elsewhere = memoryStorage()
    restoreBackup(elsewhere, readBackup(createBackup(here, { ...anime, userName: 'zen' }, now)!.json, anime))
    const restored = replay(loadDuelLog(elsewhere, anime)!)
    expect(restored).toEqual(replay(log))
    expect(restored.sortGoal).toBe('score-new-titles')
    expect(restored.forgotten).toEqual([3, next.b])
    expect(restored.newTitles!.levels.flatMap((l) => l.anchors)).toEqual([101, 102, 103, 104, 105])
  })

  it('names the file after the user, Media Type and day', () => {
    const here = memoryStorage()
    saveDuelLog(here, someProgress())
    expect(createBackup(here, { ...anime, userName: 'zen' }, now)!.fileName).toBe('aniduel-zen-anime-2026-10-05.json')
  })

  describe('Restore refuses a file that does not fit, saying why', () => {
    function backupOf(log: DuelLog): string {
      const storage = memoryStorage()
      saveDuelLog(storage, log)
      return createBackup(storage, { userId: log.header.userId, mediaType: log.header.mediaType, userName: 'zen' }, now)!.json
    }
    const edited = (json: string, change: (b: Record<string, unknown>) => void) => {
      const b = JSON.parse(json) as Record<string, unknown>
      change(b)
      return JSON.stringify(b)
    }

    it('for the other Media Type', () => {
      const manga = backupOf(startLog({ userId: 7, mediaType: 'MANGA', seed: 1, ids: [1] }))
      expect(() => readBackup(manga, anime)).toThrow('This Backup is for Manga — switch to Manga first.')
    })

    it('for another AniList account', () => {
      const other = backupOf(startLog({ userId: 8, mediaType: 'ANIME', seed: 1, ids: [1] }))
      expect(() => readBackup(other, anime)).toThrow('This Backup belongs to a different AniList account.')
    })

    it('that is not a Backup at all', () => {
      expect(() => readBackup('{not json', anime)).toThrow('This file is not an AniDuel! Backup.')
      expect(() => readBackup('{"hello":1}', anime)).toThrow('This file is not an AniDuel! Backup.')
    })

    it('from a newer version of AniDuel!', () => {
      const newer = edited(backupOf(someProgress()), (b) => (b.version = 2))
      expect(() => readBackup(newer, anime)).toThrow('This Backup was made by a newer version of AniDuel!.')
    })

    it('whose Duel log does not replay', () => {
      const broken = edited(backupOf(someProgress()), (b) => {
        const log = b.log as DuelLog
        log.events.push({ type: 'band-assigned', id: 1, band: 0 })
      })
      expect(() => readBackup(broken, anime)).toThrow(/This Backup is damaged/)
    })

    it('whose log header disagrees with the file', () => {
      const tampered = edited(backupOf(startLog({ userId: 8, mediaType: 'ANIME', seed: 1, ids: [1] })), (b) => (b.userId = 7))
      expect(() => readBackup(tampered, anime)).toThrow('This Backup belongs to a different AniList account.')
    })
  })

  it('Restore replaces the progress already in this browser, and leaves the other Media Type alone', () => {
    const elsewhere = memoryStorage()
    saveDuelLog(elsewhere, startLog({ ...anime, seed: 9, ids: [9, 8] }))
    savePoolSettings(elsewhere, anime, { statuses: ['CURRENT'] })
    const manga = startLog({ userId: 7, mediaType: 'MANGA', seed: 3, ids: [5] })
    saveDuelLog(elsewhere, manga)

    const here = memoryStorage()
    saveDuelLog(here, someProgress())
    savePoolSettings(here, anime, { statuses: ['COMPLETED'] })
    restoreBackup(elsewhere, readBackup(createBackup(here, { ...anime, userName: 'zen' }, now)!.json, anime))

    expect(loadDuelLog(elsewhere, anime)).toEqual(someProgress())
    expect(loadPoolSettings(elsewhere, anime)).toEqual({ statuses: ['COMPLETED'] })
    expect(loadDuelLog(elsewhere, { userId: 7, mediaType: 'MANGA' })).toEqual(manga)
  })

  it('has nothing to back up when there is no Ranking yet', () => {
    expect(createBackup(memoryStorage(), { ...anime, userName: 'zen' }, now)).toBeNull()
  })
})
