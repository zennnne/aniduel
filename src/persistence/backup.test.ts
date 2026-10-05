import { describe, expect, it } from 'vitest'
import { replay, startLog, type DuelLog } from '../ranking/engine.ts'
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
    const scoring = { format: 'POINT_5' as const, settings: { distribution: 'bell' as const, best: 5, worst: 2 } }
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
