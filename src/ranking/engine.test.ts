import { describe, expect, it } from 'vitest'
import { ReplayError, replay, startLog, type DuelLog, type LogEvent } from './engine.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

describe('Rough Sort', () => {
  it('prompts the first added title, with nothing done yet', () => {
    const state = replay(logOf([10, 20, 30]))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 10 })
    expect(state.progress.roughSort).toEqual({ done: 0, total: 3 })
  })

  it('puts each answered title into its Band and prompts the next one in order', () => {
    const state = replay(
      logOf([10, 20, 30], { type: 'band-assigned', id: 10, band: 2 }, { type: 'band-assigned', id: 20, band: 0 }),
    )
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 30 })
    expect(state.progress.roughSort).toEqual({ done: 2, total: 3 })
    expect(state.bands.map((b) => b.titles)).toEqual([[20], [], [10], [], []])
  })

  it('keeps titles in a Band in the order they were assigned', () => {
    const state = replay(
      logOf([1, 2, 3], { type: 'band-assigned', id: 1, band: 4 }, { type: 'band-assigned', id: 2, band: 1 }, { type: 'band-assigned', id: 3, band: 4 }),
    )
    expect(state.bands[4].titles).toEqual([1, 3])
    expect(state.bands[1].titles).toEqual([2])
  })

  it('reports Rough Sort as done once every title has a Band', () => {
    const state = replay(logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, { type: 'band-assigned', id: 2, band: 3 }))
    expect(state.prompt).toEqual({ kind: 'rough-sort-done' })
    expect(state.progress.roughSort).toEqual({ done: 2, total: 2 })
  })
})

describe('Forgotten', () => {
  it('takes a title out of Rough Sort into the Forgotten set, counting it as done', () => {
    const state = replay(logOf([1, 2, 3], { type: 'forgotten', id: 1 }))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 2 })
    expect(state.forgotten).toEqual([1])
    expect(state.progress.roughSort).toEqual({ done: 1, total: 3 })
    expect(state.bands.flatMap((b) => b.titles)).toEqual([])
  })

  it('takes a title that already has a Band out of that Band', () => {
    const state = replay(
      logOf([1, 2, 3], { type: 'band-assigned', id: 1, band: 0 }, { type: 'band-assigned', id: 2, band: 0 }, { type: 'forgotten', id: 1 }),
    )
    expect(state.bands[0].titles).toEqual([2])
    expect(state.forgotten).toEqual([1])
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 3 })
  })
})

describe('Undo', () => {
  const undo: LogEvent = { type: 'undo' }

  it('cancels the last Band choice and prompts that title again', () => {
    const state = replay(logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, undo))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 1 })
    expect(state.bands[0].titles).toEqual([])
    expect(state.progress.roughSort).toEqual({ done: 0, total: 2 })
  })

  it('cancels several answers in a row, newest first, including Forgotten', () => {
    const state = replay(
      logOf(
        [1, 2, 3],
        { type: 'band-assigned', id: 1, band: 0 },
        { type: 'forgotten', id: 2 },
        { type: 'band-assigned', id: 3, band: 4 },
        undo,
        undo,
      ),
    )
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 2 })
    expect(state.forgotten).toEqual([])
    expect(state.bands.map((b) => b.titles)).toEqual([[1], [], [], [], []])
  })

  it('lets the user answer again after an undo', () => {
    const state = replay(
      logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, undo, { type: 'band-assigned', id: 1, band: 3 }),
    )
    expect(state.bands[3].titles).toEqual([1])
    expect(state.bands[0].titles).toEqual([])
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 2 })
  })

  it('does nothing when there is nothing left to undo, and says so', () => {
    expect(replay(logOf([1, 2])).canUndo).toBe(false)
    expect(replay(logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 })).canUndo).toBe(true)
    const state = replay(logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, undo, undo, undo))
    expect(state.prompt).toEqual({ kind: 'rough-sort', id: 1 })
    expect(state.canUndo).toBe(false)
  })

  it('cannot reach back past titles added later (a sync)', () => {
    const state = replay(
      logOf([1, 2], { type: 'band-assigned', id: 1, band: 0 }, { type: 'titles-added', ids: [3] }, undo),
    )
    expect(state.bands[0].titles).toEqual([1])
    expect(state.canUndo).toBe(false)
    expect(state.progress.roughSort).toEqual({ done: 1, total: 3 })
  })
})

describe('a log the engine cannot trust', () => {
  it('is refused when its engine or format version is unknown', () => {
    const log = logOf([1])
    expect(() => replay({ ...log, header: { ...log.header, engine: 99 } })).toThrow(ReplayError)
    expect(() => replay({ ...log, header: { ...log.header, format: 99 } })).toThrow(ReplayError)
  })

  it('fails loudly when a Band choice is for a title other than the one prompted', () => {
    expect(() => replay(logOf([1, 2], { type: 'band-assigned', id: 2, band: 0 }))).toThrow(ReplayError)
    expect(() => replay(logOf([1], { type: 'band-assigned', id: 1, band: 0 }, { type: 'band-assigned', id: 1, band: 1 }))).toThrow(
      ReplayError,
    )
  })

  it('fails loudly when a Forgotten title is not in the Ranking or Rough Sort', () => {
    expect(() => replay(logOf([1], { type: 'forgotten', id: 9 }))).toThrow(ReplayError)
    expect(() => replay(logOf([1], { type: 'forgotten', id: 1 }, { type: 'forgotten', id: 1 }))).toThrow(ReplayError)
  })

  it('fails loudly when a title is added twice', () => {
    expect(() => replay(logOf([1, 2], { type: 'titles-added', ids: [2] }))).toThrow(ReplayError)
  })
})

describe('a golden log', () => {
  // Fixed log + fixed result: if this breaks, old saved progress would replay differently (ADR 0005).
  const golden: DuelLog = {
    header: { format: 1, engine: 1, seed: 123456789, userId: 5, mediaType: 'MANGA' },
    events: [
      { type: 'titles-added', ids: [101, 102, 103, 104, 105, 106] },
      { type: 'band-assigned', id: 101, band: 1 },
      { type: 'band-assigned', id: 102, band: 0 },
      { type: 'forgotten', id: 103 },
      { type: 'band-assigned', id: 104, band: 1 },
      { type: 'undo' },
      { type: 'band-assigned', id: 104, band: 4 },
      { type: 'titles-added', ids: [107] },
      { type: 'forgotten', id: 101 },
      { type: 'band-assigned', id: 105, band: 2 },
    ],
  }

  it('replays to the same state every time', () => {
    const expected = {
      prompt: { kind: 'rough-sort', id: 106 },
      bands: [{ titles: [102] }, { titles: [] }, { titles: [105] }, { titles: [] }, { titles: [104] }],
      forgotten: [103, 101],
      progress: { roughSort: { done: 5, total: 7 } },
      canUndo: true,
    }
    expect(replay(golden)).toEqual(expected)
    expect(replay(golden)).toEqual(expected)
  })
})
