// Request limiter: AniList allows a number of requests a minute per user, counting reads and writes alike. Every
// request the write queue and Catch-up's suggestion candidates send takes a turn here first, so together they stay
// under it.
import type { Clock } from '../clock.ts'

/** AniList's limit is 30 requests a minute (degraded from 90); a few are left for the app's other reads. */
export const REQUESTS_PER_MINUTE = 27

/** Wait after a 429 without an `X-RateLimit-Reset` header. `Retry-After` is never read: CORS doesn't expose it. */
export const DEFAULT_RESET_WAIT_MS = 60_000

const MINUTE_MS = 60_000

export type RequestLimiter = {
  /** Resolves when the next request may go: fewer than the limit went in the minute before. Ends early on abort. */
  turn(signal?: AbortSignal): Promise<void>
}

export function createRequestLimiter(clock: Clock, perMinute = REQUESTS_PER_MINUTE): RequestLimiter {
  // When each request went or will go, oldest first. A turn reserves its time at once, so callers waiting together
  // are counted together.
  const sent: number[] = []
  return {
    async turn(signal) {
      const now = clock.now()
      while (sent.length > 0 && sent[0] <= now - MINUTE_MS) sent.shift()
      const free = sent.length < perMinute ? now : sent[sent.length - perMinute] + MINUTE_MS
      const at = Math.max(free, sent.at(-1) ?? free)
      sent.push(at)
      if (at > now) await clock.sleep(at - now, signal)
    },
  }
}
