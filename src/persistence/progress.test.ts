import { describe, expect, it } from 'vitest'
import { replay, startLog } from '../ranking/engine.ts'
import {
  deleteDuelLog,
  deleteSavedProgress,
  loadDuelLog,
  loadLastMediaType,
  loadPoolSettings,
  loadScoringSettings,
  saveDuelLog,
  saveScoringSettings,
  saveLastMediaType,
  savePoolSettings,
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

describe('Duel log', () => {
  it('comes back as it was saved, so replay resumes at the same point', () => {
    const storage = memoryStorage()
    const log = startLog({ ...anime, seed: 1, ids: [1, 2, 3] })
    log.events.push({ type: 'band-assigned', id: 1, band: 2 })
    saveDuelLog(storage, log)

    const loaded = loadDuelLog(storage, anime)
    expect(loaded).toEqual(log)
    expect(replay(loaded!).prompt).toEqual({ kind: 'rough-sort', id: 2 })
  })

  it('is kept separately for each user and Media Type', () => {
    const storage = memoryStorage()
    saveDuelLog(storage, startLog({ ...anime, seed: 1, ids: [1] }))
    expect(loadDuelLog(storage, { userId: 7, mediaType: 'MANGA' })).toBeNull()
    expect(loadDuelLog(storage, { userId: 8, mediaType: 'ANIME' })).toBeNull()
  })

  it('is deleted with the rest of a user’s progress on logout', () => {
    const storage = memoryStorage()
    saveDuelLog(storage, startLog({ ...anime, seed: 1, ids: [1] }))
    deleteSavedProgress(storage, 7)
    expect(loadDuelLog(storage, anime)).toBeNull()
  })

  it('refuses a stored log that is unreadable or belongs to someone else, instead of silently starting over', () => {
    const storage = memoryStorage()
    saveDuelLog(storage, startLog({ userId: 8, mediaType: 'ANIME', seed: 1, ids: [1] }))
    const key = [...Array(storage.length).keys()].map((i) => storage.key(i)!)[0]
    storage.setItem(key.replace('/8/', '/7/'), storage.getItem(key)!)
    expect(() => loadDuelLog(storage, anime)).toThrow()

    storage.setItem(key, '{not json')
    expect(() => loadDuelLog(storage, { userId: 8, mediaType: 'ANIME' })).toThrow()
  })
})

describe('Start over', () => {
  it('throws away the Ranking for one Media Type only, keeping the chosen statuses', () => {
    const storage = memoryStorage()
    saveDuelLog(storage, startLog({ ...anime, seed: 1, ids: [1] }))
    saveDuelLog(storage, startLog({ userId: 7, mediaType: 'MANGA', seed: 1, ids: [2] }))
    savePoolSettings(storage, anime, { statuses: ['COMPLETED'] })

    deleteDuelLog(storage, anime)

    expect(loadDuelLog(storage, anime)).toBeNull()
    expect(loadDuelLog(storage, { userId: 7, mediaType: 'MANGA' })).not.toBeNull()
    expect(loadPoolSettings(storage, anime)).toEqual({ statuses: ['COMPLETED'] })
  })
})

describe('Scoring settings', () => {
  const saved = { format: 'POINT_10' as const, settings: { distribution: 'bell' as const, best: 9, worst: 2 } }

  it('remembers the scoring settings and their Score Format for each Media Type', () => {
    const storage = memoryStorage()
    expect(loadScoringSettings(storage, anime)).toBeNull()
    saveScoringSettings(storage, anime, saved)
    expect(loadScoringSettings(storage, anime)).toEqual(saved)
    expect(loadScoringSettings(storage, { userId: 7, mediaType: 'MANGA' })).toBeNull()
  })

  it('ignores saved scoring settings it does not understand', () => {
    const storage = memoryStorage()
    saveScoringSettings(storage, anime, saved)
    const key = storage.key(0)!
    for (const bad of ['nope', '{"format":"POINT_7","settings":{"distribution":"bell","best":9,"worst":2}}', '{"format":"POINT_10","settings":{"distribution":"zigzag","best":9,"worst":2}}', '{"format":"POINT_10","settings":{"distribution":"bell","best":9,"worst":0}}']) {
      storage.setItem(key, bad)
      expect(loadScoringSettings(storage, anime)).toBeNull()
    }
  })
})

describe('Pool settings', () => {
  it('remembers the chosen statuses for each Media Type', () => {
    const storage = memoryStorage()
    expect(loadPoolSettings(storage, anime)).toBeNull()
    savePoolSettings(storage, anime, { statuses: ['COMPLETED', 'DROPPED'] })
    savePoolSettings(storage, { userId: 7, mediaType: 'MANGA' }, { statuses: ['CURRENT'] })
    expect(loadPoolSettings(storage, anime)).toEqual({ statuses: ['COMPLETED', 'DROPPED'] })
    expect(loadPoolSettings(storage, { userId: 7, mediaType: 'MANGA' })).toEqual({ statuses: ['CURRENT'] })
  })

  it('ignores saved settings it does not understand', () => {
    const storage = memoryStorage()
    savePoolSettings(storage, anime, { statuses: ['COMPLETED'] })
    const key = storage.key(0)!
    storage.setItem(key, '{"statuses":["PLANNING","BOGUS","COMPLETED"]}')
    expect(loadPoolSettings(storage, anime)).toEqual({ statuses: ['COMPLETED'] })
    storage.setItem(key, 'nope')
    expect(loadPoolSettings(storage, anime)).toBeNull()
  })

  it('remembers which Media Type the user worked on last, until logout deletes progress', () => {
    const storage = memoryStorage()
    expect(loadLastMediaType(storage, 7)).toBeNull()
    saveLastMediaType(storage, 7, 'MANGA')
    expect(loadLastMediaType(storage, 7)).toBe('MANGA')
    expect(loadLastMediaType(storage, 8)).toBeNull()
    deleteSavedProgress(storage, 7)
    expect(loadLastMediaType(storage, 7)).toBeNull()
  })
})
