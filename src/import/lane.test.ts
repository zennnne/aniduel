import { describe, expect, it } from 'vitest'
import type { AniListGateway } from '../anilist/gateway.ts'
import { sharedWriteLane } from './lane.ts'
import { WRITE_SPACING_MS, type Clock } from './runner.ts'

function fakeClock(): Clock {
  let now = 1_760_000_000_000
  return { now: () => now, sleep: async (ms) => void (now += ms) }
}

function fakeGateway(clock: Clock) {
  const writes: Array<{ kind: string; mediaId: number; at: number }> = []
  const gateway: AniListGateway = {
    viewer: async () => ({ id: 1, name: 'u', avatarUrl: null, titleLanguage: 'ROMAJI', scoreFormat: 'POINT_100' }),
    mediaList: async () => [],
    saveScore: async (mediaId) => void writes.push({ kind: 'score', mediaId, at: clock.now() }),
    saveStatus: async (mediaId) => void writes.push({ kind: 'status', mediaId, at: clock.now() }),
    rateLimit: () => ({ remaining: 12, resetAt: null }),
  }
  return { gateway, writes }
}

describe('shared write lane', () => {
  it('spaces writes from Import and Catch-up together, as if they were one queue', async () => {
    const clock = fakeClock()
    const { gateway, writes } = fakeGateway(clock)
    const lane = sharedWriteLane(gateway, clock)

    await Promise.all([lane.saveScore(1, 90), lane.saveStatus(2, 'COMPLETED'), lane.saveScore(3, 80)])

    expect(writes.map((w) => [w.kind, w.mediaId])).toEqual([['score', 1], ['status', 2], ['score', 3]])
    expect(writes.map((w) => w.at - writes[0].at)).toEqual([0, WRITE_SPACING_MS, 2 * WRITE_SPACING_MS])
  })

  it('does not hold up a write that comes after a long enough pause', async () => {
    const clock = fakeClock()
    const { gateway, writes } = fakeGateway(clock)
    const lane = sharedWriteLane(gateway, clock)

    await lane.saveStatus(1, 'COMPLETED')
    await clock.sleep(5000)
    await lane.saveStatus(2, 'COMPLETED')

    expect(writes[1].at - writes[0].at).toBe(5000)
  })

  it('keeps going after a failed write', async () => {
    const clock = fakeClock()
    const { gateway, writes } = fakeGateway(clock)
    const failing = { ...gateway, saveStatus: async () => Promise.reject(new Error('down')) }
    const lane = sharedWriteLane(failing, clock)

    await expect(lane.saveStatus(1, 'COMPLETED')).rejects.toThrow('down')
    await lane.saveScore(2, 50)

    expect(writes.map((w) => w.mediaId)).toEqual([2])
  })

  it('passes reads and the rate-limit headers through', async () => {
    const clock = fakeClock()
    const { gateway } = fakeGateway(clock)
    const lane = sharedWriteLane(gateway, clock)

    expect(lane.rateLimit()).toEqual({ remaining: 12, resetAt: null })
    expect(await lane.mediaList({ userId: 1, type: 'ANIME', statuses: [] })).toEqual([])
  })
})
