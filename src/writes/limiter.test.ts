import { describe, expect, it } from 'vitest'
import type { Clock } from '../clock.ts'
import { createRequestLimiter } from './limiter.ts'

const START = 1_760_000_000_000

function fakeClock(): Clock {
  let now = START
  return {
    now: () => now,
    sleep: async (ms) => {
      await Promise.resolve() // time moves on after what is already queued, as a real sleep would
      now += ms
    },
  }
}

describe('Request limiter', () => {
  it('lets requests go at once while fewer than the limit went in the last minute', async () => {
    const clock = fakeClock()
    const limiter = createRequestLimiter(clock, 3)
    const at: number[] = []
    for (let i = 0; i < 3; i++) {
      await limiter.turn()
      at.push(clock.now() - START)
    }
    expect(at).toEqual([0, 0, 0])
  })

  it('holds the next request until the oldest of the last minute is a minute old', async () => {
    const clock = fakeClock()
    const limiter = createRequestLimiter(clock, 3)
    const at: number[] = []
    for (let i = 0; i < 7; i++) {
      await limiter.turn()
      at.push(clock.now() - START)
    }
    expect(at).toEqual([0, 0, 0, 60_000, 60_000, 60_000, 120_000])
  })

  it('counts requests from callers taking turns at the same time', async () => {
    const clock = fakeClock()
    const limiter = createRequestLimiter(clock, 2)
    const at: number[] = []
    await Promise.all([1, 2, 3].map(() => limiter.turn().then(() => at.push(clock.now() - START))))
    expect(at.sort((a, b) => a - b)).toEqual([0, 0, 60_000])
  })
})
