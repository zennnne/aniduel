import { describe, expect, it } from 'vitest'
import { ReplayError, replay, startLog } from '../ranking/engine.ts'
import { appendAndReplay } from './useDuelLog.ts'

const log = startLog({ seed: 42, userId: 7, mediaType: 'ANIME', ids: [1, 2] })

describe('appendAndReplay', () => {
  it('appends the events and gives the log with its replay (ADR 0005)', () => {
    const next = appendAndReplay(log, [{ type: 'forgotten', id: 1 }])
    expect(next.log.events).toEqual([...log.events, { type: 'forgotten', id: 1 }])
    expect(next.ranking).toEqual(replay(next.log))
  })

  it('gives the log itself when there is nothing to append', () => {
    expect(appendAndReplay(log, []).log).toBe(log)
  })

  it('throws when the log no longer replays', () => {
    expect(() => appendAndReplay(log, [{ type: 'forgotten', id: 9 }])).toThrow(ReplayError)
  })
})
