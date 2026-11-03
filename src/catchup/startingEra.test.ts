import { describe, expect, it } from 'vitest'
import { deleteSavedProgress } from '../persistence/progress.ts'
import { createStartingEraStore } from './startingEra.ts'

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

describe('Starting era store', () => {
  it('has no answer until the user gives one', () => {
    expect(createStartingEraStore(memoryStorage(), 1, 'ANIME').answer()).toBeUndefined()
  })

  it('remembers the year across visits', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'ANIME').save(2012)

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBe(2012)
  })

  it('remembers a skip (all-time favourites) as null, apart from no answer', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'ANIME').save(null)

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBeNull()
  })

  it('keeps each user’s answer apart', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'ANIME').save(2012)
    createStartingEraStore(storage, 2, 'ANIME').save(2004)

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBe(2012)
    expect(createStartingEraStore(storage, 2, 'ANIME').answer()).toBe(2004)
  })

  it('treats an unreadable saved answer as none', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'ANIME').save(2012)
    for (let i = 0; i < storage.length; i++) storage.setItem(storage.key(i)!, '{"year":"soon"}')

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBeUndefined()
  })

  it('is deleted with the rest of the user’s progress on logout', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'ANIME').save(2012)

    deleteSavedProgress(storage, 1)

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBeUndefined()
  })
})

describe('Starting era store per Media Type', () => {
  it('keeps the manga answer apart from the anime one', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'ANIME').save(2005)
    createStartingEraStore(storage, 1, 'MANGA').save(2018)

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBe(2005)
    expect(createStartingEraStore(storage, 1, 'MANGA').answer()).toBe(2018)
  })

  it('reads the anime answer saved before Catch-up had manga', () => {
    const storage = memoryStorage()
    storage.setItem('aniduel/progress/1/ANIME/catchup-starting-era', JSON.stringify({ year: 2010 }))

    expect(createStartingEraStore(storage, 1, 'ANIME').answer()).toBe(2010)
    expect(createStartingEraStore(storage, 1, 'MANGA').answer()).toBeUndefined()
  })

  it('is deleted with the rest of the user’s progress', () => {
    const storage = memoryStorage()
    createStartingEraStore(storage, 1, 'MANGA').save(2018)

    deleteSavedProgress(storage, 1)

    expect(createStartingEraStore(storage, 1, 'MANGA').answer()).toBeUndefined()
  })
})
