import { describe, expect, it } from 'vitest'
import { ReplayError, replay, replayer, startLog, type LogEvent } from '../ranking/engine.ts'
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

  it('gives the same through a replayer, which keeps going after an Undo and a refused event', () => {
    const replayLog = replayer()
    let shown = appendAndReplay(log, [], replayLog)
    const events: LogEvent[] = [{ type: 'band-assigned', id: 1, band: 0 }, { type: 'undo' }, { type: 'band-assigned', id: 1, band: 2 }]
    for (const event of events) {
      expect(() => appendAndReplay(shown.log, [{ type: 'forgotten', id: 9 }], replayLog)).toThrow(ReplayError)
      shown = appendAndReplay(shown.log, [event], replayLog)
      expect(shown.ranking).toEqual(replay(shown.log))
    }
  })

  it('throws when the log no longer replays', () => {
    expect(() => appendAndReplay(log, [{ type: 'forgotten', id: 9 }])).toThrow(ReplayError)
  })
})
