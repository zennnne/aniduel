// Catch-up's Passed history (#50): kept per user in injected Storage, hidden for 30 days, clearable.
import { describe, expect, it } from 'vitest'
import type { CatchUpMedia } from '../anilist/candidates.ts'
import { firstBatch, saveBatch, setMark } from './batch.ts'
import { deleteSavedProgress } from '../persistence/progress.ts'
import { createPassedStore } from './passed.ts'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 8)

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

describe('Passed store', () => {
  it('remembers Passed titles after a reload, for that user only', () => {
    const storage = memoryStorage()
    createPassedStore(storage, 7, 'ANIME').record([1, 2], NOW)

    expect(createPassedStore(storage, 7, 'ANIME').history()).toEqual(new Map([[1, NOW], [2, NOW]]))
    expect(createPassedStore(storage, 8, 'ANIME').history()).toEqual(new Map())
  })
  it('counts a title as hidden until 30 days have passed, then not', () => {
    const store = createPassedStore(memoryStorage(), 7, 'ANIME')
    store.record([1], NOW - 30 * DAY + 1)
    store.record([2], NOW - 30 * DAY)

    expect(store.hiddenCount(NOW)).toBe(1)
  })

  it('keeps a title out of suggestions for 30 days, then lets it back', () => {
    const store = createPassedStore(memoryStorage(), 7, 'ANIME')
    store.record([1], NOW - 30 * DAY + 1)
    store.record([2], NOW - 30 * DAY)
    const media = [anime(1), anime(2)]

    const suggested = firstBatch({ list, media, passed: store.history(), now: NOW, seed: 1 }).suggestions.map((s) => s.media.id)

    expect(suggested).toEqual([2])
  })

  it('forgets titles more than 30 days old when it records new ones', () => {
    const storage = memoryStorage()
    const store = createPassedStore(storage, 7, 'ANIME')
    store.record([1], NOW - 30 * DAY)
    store.record([2], NOW)

    expect(store.history()).toEqual(new Map([[2, NOW]]))
  })

  it('clear empties the history, so every title can be suggested again', () => {
    const storage = memoryStorage()
    createPassedStore(storage, 7, 'ANIME').record([1, 2], NOW)
    createPassedStore(storage, 8, 'ANIME').record([3], NOW)

    createPassedStore(storage, 7, 'ANIME').clear()

    expect(createPassedStore(storage, 7, 'ANIME').history()).toEqual(new Map())
    expect(createPassedStore(storage, 7, 'ANIME').hiddenCount(NOW)).toBe(0)
    expect(createPassedStore(storage, 8, 'ANIME').history()).toEqual(new Map([[3, NOW]]))
  })

  it('records only the titles left unmarked when a batch is saved', () => {
    const store = createPassedStore(memoryStorage(), 7, 'ANIME')
    const media = [anime(1), anime(2), anime(3), anime(4)]
    let batch = firstBatch({ list, media, passed: store.history(), now: NOW, seed: 1 })
    batch = setMark(batch, 1, 'COMPLETED')
    batch = setMark(batch, 2, 'DROPPED')
    batch = setMark(batch, 3, 'PLANNING')

    const saved = saveBatch(batch, { list, media, passed: store.history(), now: NOW, seed: 2 })
    store.record(saved.passed, NOW)

    expect(store.history()).toEqual(new Map([[4, NOW]]))
  })
})

/** Twelve watched titles, so the list is past the cold-start threshold. */
const list = Array.from({ length: 12 }, (_, i) => ({ mediaId: 100 + i, status: 'COMPLETED' as const, year: 2015, format: 'TV' }))

function anime(id: number): CatchUpMedia {
  return {
    id,
    title: { romaji: `Anime ${id}`, english: null, native: null },
    coverUrl: null,
    coverColor: null,
    siteUrl: '',
    year: 2015,
    format: 'TV',
    status: 'FINISHED',
    country: 'JP',
    watched: 10_000,
    tags: [],
    relations: [],
    recommendations: [],
    adaptations: [],
  }
}

describe('Passed store per Media Type', () => {
  it('keeps manga’s Passed titles apart from anime’s, and clears only its own', () => {
    const storage = memoryStorage()
    createPassedStore(storage, 7, 'ANIME').record([1], NOW)
    createPassedStore(storage, 7, 'MANGA').record([2], NOW)

    expect(createPassedStore(storage, 7, 'ANIME').history()).toEqual(new Map([[1, NOW]]))
    expect(createPassedStore(storage, 7, 'MANGA').history()).toEqual(new Map([[2, NOW]]))

    createPassedStore(storage, 7, 'MANGA').clear()

    expect(createPassedStore(storage, 7, 'MANGA').history()).toEqual(new Map())
    expect(createPassedStore(storage, 7, 'ANIME').history()).toEqual(new Map([[1, NOW]]))
  })

  it('reads the anime Passed titles saved before Catch-up had manga', () => {
    const storage = memoryStorage()
    storage.setItem('aniduel/progress/7/ANIME/catchup-passed', JSON.stringify([[1, NOW]]))

    expect(createPassedStore(storage, 7, 'ANIME').history()).toEqual(new Map([[1, NOW]]))
    expect(createPassedStore(storage, 7, 'MANGA').history()).toEqual(new Map())
  })

  it('is deleted with the rest of the user’s progress', () => {
    const storage = memoryStorage()
    createPassedStore(storage, 7, 'MANGA').record([2], NOW)

    deleteSavedProgress(storage, 7)

    expect(createPassedStore(storage, 7, 'MANGA').history()).toEqual(new Map())
  })
})
