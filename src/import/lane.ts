// Shared write lane: Import and Catch-up each run their own Runner, but AniList's rate limit is per user. Writes
// through the lane go one at a time, at least WRITE_SPACING_MS apart, whichever Runner sends them.
import type { AniListGateway } from '../anilist/gateway.ts'
import { WRITE_SPACING_MS, type Clock } from './runner.ts'

/** The gateway with its writes in one lane; reads pass straight through. */
export function sharedWriteLane(gateway: AniListGateway, clock: Clock, spacingMs = WRITE_SPACING_MS): AniListGateway {
  let tail: Promise<unknown> = Promise.resolve()
  let lastAt: number | null = null

  function inLane<T>(write: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      const wait = lastAt === null ? 0 : lastAt + spacingMs - clock.now()
      if (wait > 0) await clock.sleep(wait)
      lastAt = clock.now()
      return write()
    })
    tail = result.catch(() => {})
    return result
  }

  return {
    viewer: () => gateway.viewer(),
    mediaList: (query) => gateway.mediaList(query),
    saveScore: (mediaId, scoreRaw) => inLane(() => gateway.saveScore(mediaId, scoreRaw)),
    saveStatus: (mediaId, status) => inLane(() => gateway.saveStatus(mediaId, status)),
    rateLimit: () => gateway.rateLimit(),
  }
}
