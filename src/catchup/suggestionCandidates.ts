// Catch-up suggestion candidates: what is known about the anime the suggestions choose from. It grows as the user's list
// grows: the watched titles (seeds), one hop of their relations and recommendations, and popular titles from the
// user's era. Each update asks AniList only for what it hasn't asked for before.
import {
  CANDIDATES_PER_REQUEST,
  fetchCatchUpMedia,
  fetchPopularAnime,
  type CatchUpMedia,
  type Era,
} from '../anilist/candidates.ts'
import { AniListError } from '../anilist/gateway.ts'
import type { ListStatus } from '../anilist/types.ts'
import { isWatched } from './watched.ts'
import type { Clock } from '../clock.ts'
import { DEFAULT_RESET_WAIT_MS, type RequestLimiter } from '../writes/limiter.ts'

/** Where the suggestion candidates are read anime from: AniList, or a fake in tests. */
export type CandidateSource = {
  /** Anime by id; ids AniList doesn't return (deleted, adult) are left out. */
  media(ids: readonly number[]): Promise<CatchUpMedia[]>
  /** The most popular anime from the era, or all-time without one. */
  popular(era: Era | null): Promise<CatchUpMedia[]>
}

export type CandidateLimits = {
  /** Watched titles loaded per update; the rest follow on later updates. */
  seeds: number
  /** Relation and recommendation targets loaded per update, the most likely first. */
  neighbours: number
}

/** About 20 requests for a first visit: 10 of seeds, 8 of neighbours, 2 of popular titles. */
export const DEFAULT_LIMITS: Readonly<CandidateLimits> = { seeds: 500, neighbours: 400 }

/** A relation target counts as this many recommendation votes (log scale) when choosing what to load. */
const RELATION_PRIORITY = 100

type ListedEntry = { mediaId: number; status: ListStatus; year: number | null }

/** The years the middle 80% of the watched titles started in, or null if none has a year. */
export function eraYears(list: readonly ListedEntry[]): Era | null {
  const years = list
    .filter((e) => isWatched(e) && e.year !== null)
    .map((e) => e.year!)
    .sort((a, b) => a - b)
  if (years.length === 0) return null
  return { from: years[Math.floor(years.length * 0.1)], to: years[Math.ceil(years.length * 0.9) - 1] }
}

export type SuggestionCandidates = {
  /**
   * Loads what the list now calls for: watched titles not loaded yet, their neighbours, and popular titles when the
   * era changed. `era` overrides the era read from the list (the Starting era, for a near-empty list).
   */
  update(list: readonly ListedEntry[], era?: Era | null): Promise<void>
  /** Everything loaded so far: seeds and candidates alike, as the suggestion module takes them. */
  media(): CatchUpMedia[]
}

export function createSuggestionCandidates(source: CandidateSource, limits: CandidateLimits = DEFAULT_LIMITS): SuggestionCandidates {
  const known = new Map<number, CatchUpMedia>()
  const asked = new Set<number>()
  let popularFor: string | null = null

  async function load(ids: number[]) {
    if (ids.length === 0) return
    for (const id of ids) asked.add(id)
    for (const m of await source.media(ids)) known.set(m.id, m)
  }

  return {
    async update(list, eraOverride) {
      const listed = new Set(list.map((e) => e.mediaId))
      const watched = list.filter(isWatched).map((e) => e.mediaId)
      await load(watched.filter((id) => !asked.has(id)).slice(0, limits.seeds))

      const era = eraOverride !== undefined ? eraOverride : eraYears(list)
      const eraKey = JSON.stringify(era)
      if (popularFor !== eraKey) {
        for (const m of await source.popular(era)) {
          known.set(m.id, m)
          asked.add(m.id)
        }
        popularFor = eraKey
      }

      // Neighbours: ranked by how strongly the watched titles point at them.
      const priority = new Map<number, number>()
      const point = (id: number, weight: number) => {
        if (listed.has(id) || asked.has(id)) return
        priority.set(id, (priority.get(id) ?? 0) + weight)
      }
      for (const id of watched) {
        const seed = known.get(id)
        if (!seed) continue
        for (const r of seed.relations) point(r.mediaId, RELATION_PRIORITY)
        for (const r of seed.recommendations) point(r.mediaId, Math.log1p(Math.max(0, r.rating)))
      }
      const next = [...priority]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, limits.neighbours)
        .map(([id]) => id)
      await load(next)
    },
    media: () => [...known.values()],
  }
}

/** Runs one read; on a 429 waits until the rate-limit reset (or a minute) and tries again. Other errors pass on. */
export async function retryRateLimited<T>(
  request: () => Promise<T>,
  deps: { clock: Clock; resetAt: () => number | null },
): Promise<T> {
  for (;;) {
    try {
      return await request()
    } catch (e) {
      if (!(e instanceof AniListError) || e.kind !== 'rate-limited') throw e
      const resetAt = deps.resetAt()
      await deps.clock.sleep(resetAt === null ? DEFAULT_RESET_WAIT_MS : Math.max(0, resetAt * 1000 - deps.clock.now()))
    }
  }
}

/** Pages of 50 popular titles loaded for the era. */
const POPULAR_PAGES = 2

/**
 * The suggestion candidates' reads from AniList, 50 ids a request. Each request takes its turn in `limiter` (shared with
 * the write queue) and waits out a 429.
 */
export function aniListCandidateSource(deps: { fetch: typeof fetch; token: string; clock: Clock; limiter: RequestLimiter }): CandidateSource {
  let resetAt: number | null = null
  const read = {
    fetch: deps.fetch,
    token: deps.token,
    onRateLimit: (r: { resetAt: number | null }) => (resetAt = r.resetAt),
    // Each read waits its turn with the write queue's requests.
    beforeRequest: () => deps.limiter.turn(),
  }
  const retry = <T>(request: () => Promise<T>) => retryRateLimited(request, { clock: deps.clock, resetAt: () => resetAt })
  return {
    async media(ids) {
      const media: CatchUpMedia[] = []
      for (let i = 0; i < ids.length; i += CANDIDATES_PER_REQUEST) {
        const chunk = ids.slice(i, i + CANDIDATES_PER_REQUEST)
        media.push(...(await retry(() => fetchCatchUpMedia(read, chunk))))
      }
      return media
    },
    popular: (era) => retry(() => fetchPopularAnime(read, era, POPULAR_PAGES)),
  }
}
