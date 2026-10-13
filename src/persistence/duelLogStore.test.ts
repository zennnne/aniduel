import { describe, expect, it } from 'vitest'
import { replay, startLog, type DuelLog, type LogEvent } from '../ranking/engine.ts'
import { createDuelLogStore, type ReplayedLog } from './duelLogStore.ts'
import { memoryStorage } from './memoryStorage.ts'
import { loadDuelLog, type RankingKey } from './progress.ts'

const ANIME: RankingKey = { userId: 7, mediaType: 'ANIME' }
const log = startLog({ ...ANIME, seed: 42, ids: [1, 2] })

/** Title 9 is not in the Pool, so the engine refuses it. */
const REFUSED: LogEvent = { type: 'forgotten', id: 9 }
const unreplayable: DuelLog = { ...log, events: [...log.events, REFUSED] }

/** What the engine says of a log it can't replay. */
function engineMessage(of: DuelLog): string {
  try {
    replay(of)
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('the log replays')
}

/** A store on in-memory storage that can be made to refuse saving, with every change it reported. */
function setup() {
  const memory = memoryStorage()
  let refusing = false
  const storage: Storage = {
    ...memory,
    setItem: (key, value) => {
      if (refusing) throw new DOMException('full', 'QuotaExceededError')
      memory.setItem(key, value)
    },
  }
  const store = createDuelLogStore(storage)
  const seen: Array<ReplayedLog | null> = []
  store.subscribe((latest) => seen.push(latest))
  return { store, seen, saved: () => loadDuelLog(storage, ANIME), refuseSaves: (refuse = true) => void (refusing = refuse) }
}

describe('the Duel log store', () => {
  it('has no open log to begin with', () => {
    const { store, saved } = setup()
    expect(store.latest()).toBeNull()
    expect(saved()).toBeNull()
  })

  it('shows a log with its replay, without saving it', () => {
    const { store, seen, saved } = setup()

    const shown = store.show(log)

    expect(shown).toEqual({ ok: true, log, ranking: replay(log) })
    expect(store.latest()).toEqual({ log, ranking: replay(log) })
    expect(store.latest()!.log).toBe(log)
    expect(seen).toEqual([store.latest()])
    expect(saved()).toBeNull()
  })

  it('leaves the open log as it is when another one to show does not replay', () => {
    const { store, seen } = setup()
    store.show(log)
    const before = store.latest()

    expect(store.show(unreplayable)).toEqual({ ok: false, reason: 'does-not-replay', message: engineMessage(unreplayable) })
    expect(store.latest()).toBe(before)
    expect(seen).toHaveLength(1)
  })

  it('saves a new log and shows it', () => {
    const { store, saved } = setup()

    expect(store.save(log)).toEqual({ ok: true, log, ranking: replay(log) })
    expect(store.latest()?.log).toBe(log)
    expect(saved()).toEqual(log)
  })

  it('does not show a new log the browser refuses to save', () => {
    const { store, seen, saved, refuseSaves } = setup()
    refuseSaves()

    expect(store.save(log)).toEqual({ ok: false, reason: 'save-refused' })
    expect(store.latest()).toBeNull()
    expect(seen).toEqual([])
    expect(saved()).toBeNull()
  })

  it('does not save a new log that does not replay', () => {
    const { store, saved } = setup()

    expect(store.save(unreplayable)).toEqual({ ok: false, reason: 'does-not-replay', message: engineMessage(unreplayable) })
    expect(store.latest()).toBeNull()
    expect(saved()).toBeNull()
  })

  it('closes the open log without touching what is saved', () => {
    const { store, seen, saved } = setup()
    store.save(log)

    store.close()

    expect(store.latest()).toBeNull()
    expect(seen.at(-1)).toBeNull()
    expect(saved()).toEqual(log)
  })

  it('gives the same latest log until it changes, and stops telling an unsubscribed listener', () => {
    const { store } = setup()
    const told: Array<ReplayedLog | null> = []
    const unsubscribe = store.subscribe((latest) => told.push(latest))
    store.show(log)
    expect(store.latest()).toBe(store.latest())
    expect(told).toEqual([store.latest()])

    unsubscribe()
    store.close()
    expect(told).toHaveLength(1)
  })
})

describe('appending to the Duel log', () => {
  it('appends the events, saves the log and shows it with its replay (ADR 0005)', () => {
    const { store, seen, saved } = setup()
    store.save(log)

    const appended = store.append({ type: 'forgotten', id: 1 })

    const next = store.latest()!
    expect(next.log.events).toEqual([...log.events, { type: 'forgotten', id: 1 }])
    expect(next.ranking).toEqual(replay(next.log))
    expect(appended).toEqual({ ok: true, ...next })
    expect(saved()).toEqual(next.log)
    expect(seen.at(-1)).toBe(next)
  })

  it('keeps the log itself when there is nothing to append', () => {
    const { store } = setup()
    store.show(log)

    expect(store.append()).toMatchObject({ ok: true })
    expect(store.latest()!.log).toBe(log)
  })

  it('lands two appends in a row, the second building on the first', () => {
    const { store, saved } = setup()
    store.save(log)

    // No render in between: the second append reads the log the first one left.
    store.append({ type: 'band-assigned', id: 1, band: 0 })
    const second = store.append({ type: 'band-assigned', id: 2, band: 0 })

    const events = [...log.events, { type: 'band-assigned', id: 1, band: 0 }, { type: 'band-assigned', id: 2, band: 0 }]
    expect(second).toMatchObject({ ok: true, log: { events } })
    expect(saved()?.events).toEqual(events)
  })

  it('saves and shows nothing when the appended events do not replay', () => {
    const { store, seen, saved } = setup()
    store.save(log)
    const before = store.latest()

    expect(store.append(REFUSED)).toEqual({ ok: false, reason: 'does-not-replay', message: engineMessage(unreplayable) })
    expect(store.latest()).toBe(before)
    expect(seen).toHaveLength(1)
    expect(saved()).toEqual(log)
  })

  it('replays the same as the engine does from the start, also after an Undo and a refused event', () => {
    const { store } = setup()
    store.save(log)
    const events: LogEvent[] = [{ type: 'band-assigned', id: 1, band: 0 }, { type: 'undo' }, { type: 'band-assigned', id: 1, band: 2 }]
    for (const event of events) {
      expect(store.append(REFUSED)).toMatchObject({ ok: false, reason: 'does-not-replay' })
      expect(store.append(event)).toMatchObject({ ok: true })
      expect(store.latest()!.ranking).toEqual(replay(store.latest()!.log))
    }
  })

  it('stays on what is saved when the browser refuses to save, and a later append works from there', () => {
    const { store, seen, saved, refuseSaves } = setup()
    store.save(log)
    store.append({ type: 'band-assigned', id: 1, band: 0 })
    const before = store.latest()!
    const told = seen.length

    refuseSaves()
    expect(store.append({ type: 'band-assigned', id: 2, band: 4 })).toEqual({ ok: false, reason: 'save-refused' })
    expect(store.latest()).toBe(before)
    expect(before.ranking).toEqual(replay(before.log))
    expect(seen).toHaveLength(told)
    expect(saved()).toEqual(before.log)

    refuseSaves(false)
    expect(store.append({ type: 'band-assigned', id: 2, band: 0 })).toMatchObject({ ok: true })
    const after = store.latest()!
    // The refused answer is not in the log.
    expect(after.log.events).toEqual([...before.log.events, { type: 'band-assigned', id: 2, band: 0 }])
    expect(after.ranking).toEqual(replay(after.log))
    expect(saved()).toEqual(after.log)
  })

  it('has nothing to append to without an open log', () => {
    const { store, seen, saved } = setup()

    expect(store.append({ type: 'forgotten', id: 1 })).toEqual({ ok: false, reason: 'no-open-log' })
    expect(store.latest()).toBeNull()
    expect(seen).toEqual([])
    expect(saved()).toBeNull()
  })
})
