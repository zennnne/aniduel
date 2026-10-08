// Holdout eval for the Catch-up weights (#44): hide part of real AniList lists and count how many hidden titles each
// weight variant brings back into the batch of 20. A throwaway prototype, kept out of the test suite; it reuses the
// suggestion module and the candidate query rather than copying them.
import { fetchCatchUpMedia, fetchPopularAnime, type CatchUpMedia } from '../../src/anilist/candidates.ts'
import { AniListError, request } from '../../src/anilist/gateway.ts'
import type { ListStatus } from '../../src/anilist/types.ts'
import { eraYears } from '../../src/catchup/candidatePool.ts'
import { BATCH_SIZE, DEFAULT_WEIGHTS, suggestCatchUp, type CatchUpWeights } from '../../src/catchup/suggest.ts'

export const VARIANTS: ReadonlyArray<{ name: string; weights: CatchUpWeights }> = [
  { name: 'starting', weights: { ...DEFAULT_WEIGHTS } },
  { name: 'no tags', weights: { ...DEFAULT_WEIGHTS, tags: 0 } },
  { name: 'tags 0.2', weights: { ...DEFAULT_WEIGHTS, tags: 0.2 } },
  { name: 'popularity only', weights: { relations: 0, recommendations: 0, popularity: 1, tags: 0 } },
]

/** Share of each list's watched titles hidden from the suggestion module. */
export const HOLDOUT_SHARE = 0.2

/** AniList allows 30 requests a minute just now; this keeps a little under it. */
export const REQUEST_SPACING_MS = 2100

/** How long to wait after a 429 that has no Retry-After header. */
const DEFAULT_RETRY_AFTER_MS = 60_000

/** Retries of one request after 429s before giving up. */
const MAX_RATE_LIMIT_RETRIES = 5

/** Pages of 50 popular titles fetched from the user's era, standing in for Catch-up's popular-in-era candidates. */
const ERA_PAGES = 2

export type EvalDeps = {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  log: (line: string) => void
}

/**
 * Wraps `fetch` to start requests at least `spacingMs` apart and to wait out every 429 (Retry-After when given) before
 * trying again, so the gateway's callers never see a rate-limit error unless AniList keeps refusing.
 */
export function rateLimitedFetch(deps: EvalDeps, spacingMs = REQUEST_SPACING_MS): typeof fetch {
  let nextAt = 0
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const wait = nextAt - deps.now()
      if (wait > 0) await deps.sleep(wait)
      nextAt = deps.now() + spacingMs
      const response = await deps.fetch(input, init)
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response
      const retryAfter = Number(response.headers.get('Retry-After'))
      const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_AFTER_MS
      deps.log(`rate-limited; waiting ${Math.ceil(ms / 1000)}s`)
      nextAt = deps.now() + ms
    }
  }
}

/** mulberry32, so the holdout is the same on every run. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type EvalEntry = { mediaId: number; status: ListStatus; year: number | null; format: string | null }

/** Splits the watched (non-Planning) entries into a seeded ~20% hidden set; the rest of the list stays visible. */
export function holdout(
  list: readonly EvalEntry[],
  seed: number,
  share = HOLDOUT_SHARE,
): { visible: EvalEntry[]; hidden: Set<number> } {
  const watched = list.filter((e) => e.status !== 'PLANNING').sort((a, b) => a.mediaId - b.mediaId)
  const next = random(seed)
  const shuffled = watched.map((e) => ({ e, key: next() })).sort((a, b) => a.key - b.key)
  const hidden = new Set(shuffled.slice(0, Math.round(watched.length * share)).map(({ e }) => e.mediaId))
  return { visible: list.filter((e) => !hidden.has(e.mediaId)), hidden }
}

const USER_LIST_QUERY = `query ($userName: String, $chunk: Int) {
  MediaListCollection(userName: $userName, type: ANIME, chunk: $chunk, perChunk: 500) {
    hasNextChunk
    lists { entries { mediaId status media { startDate { year } format } } }
  }
}`

type RawUserList = {
  MediaListCollection: {
    hasNextChunk: boolean
    lists: Array<{
      entries: Array<{
        mediaId: number
        status: ListStatus
        media: { startDate: { year: number | null } | null; format: string | null }
      }>
    }>
  }
}

/** A public anime list by user name; needs no login. */
export async function fetchPublicList(fetchFn: typeof fetch, userName: string): Promise<EvalEntry[]> {
  const byId = new Map<number, EvalEntry>()
  for (let chunk = 1; ; chunk++) {
    const data = await request<RawUserList>({ fetch: fetchFn, token: null }, USER_LIST_QUERY, { userName, chunk })
    for (const list of data.MediaListCollection.lists) {
      for (const e of list.entries) {
        if (!byId.has(e.mediaId)) {
          byId.set(e.mediaId, {
            mediaId: e.mediaId,
            status: e.status,
            year: e.media.startDate?.year ?? null,
            format: e.media.format,
          })
        }
      }
    }
    if (!data.MediaListCollection.hasNextChunk) break
  }
  return [...byId.values()]
}

export type UserResult = {
  userName: string
  watched: number
  hidden: number
  candidates: number
  /** Hidden titles anywhere in the candidate pool: the most any variant could hit (capped at the batch size). */
  reachable: number
  hits: Record<string, number>
}

/** Runs every variant on one user's list. */
export async function evaluateUser(
  deps: EvalDeps,
  fetchFn: typeof fetch,
  userName: string,
  seed: number,
): Promise<UserResult> {
  const list = await fetchPublicList(fetchFn, userName)
  const { visible, hidden } = holdout(list, seed)
  const watchedIds = visible.filter((e) => e.status !== 'PLANNING').map((e) => e.mediaId)
  const onVisibleList = new Set(visible.map((e) => e.mediaId))
  deps.log(`${userName}: ${list.length} entries, ${watchedIds.length + hidden.size} watched, ${hidden.size} hidden`)

  // Seeds: the visible watched titles, with their relations, recommendations and tags.
  const seeds = await fetchCatchUpMedia({ fetch: fetchFn, token: '' }, watchedIds)
  // Candidates: one hop out from the seeds, plus popular titles from the user's era, as Catch-up would feed them.
  const expanded = new Set<number>()
  for (const m of seeds) {
    for (const r of m.relations) expanded.add(r.mediaId)
    for (const r of m.recommendations) expanded.add(r.mediaId)
  }
  const era = eraYears(visible)
  const popular = era ? await fetchPopularAnime({ fetch: fetchFn, token: null }, era, ERA_PAGES) : []
  const known = new Set([...seeds, ...popular].map((m) => m.id))
  const candidateIds = [...expanded].filter((id) => !onVisibleList.has(id) && !known.has(id))
  deps.log(`${userName}: ${seeds.length} seeds, fetching ${candidateIds.length} candidates`)
  const candidates = await fetchCatchUpMedia({ fetch: fetchFn, token: '' }, candidateIds)
  const media = [...new Map([...seeds, ...popular, ...candidates].map((m) => [m.id, m])).values()]

  return scoreVariants(userName, visible, hidden, media, seed)
}

/** Runs each variant over already-fetched data and counts hidden titles in its batch. Pure. */
export function scoreVariants(
  userName: string,
  visible: readonly EvalEntry[],
  hidden: ReadonlySet<number>,
  media: readonly CatchUpMedia[],
  seed: number,
): UserResult {
  const hits: Record<string, number> = {}
  for (const variant of VARIANTS) {
    const batch = suggestCatchUp({ list: visible, media, passed: new Map(), now: 0, seed, weights: variant.weights })
    hits[variant.name] = batch.filter((s) => hidden.has(s.media.id)).length
  }
  const onVisibleList = new Set(visible.map((e) => e.mediaId))
  const candidates = media.filter((m) => !onVisibleList.has(m.id))
  return {
    userName,
    watched: visible.filter((e) => e.status !== 'PLANNING').length + hidden.size,
    hidden: hidden.size,
    candidates: candidates.length,
    reachable: Math.min(BATCH_SIZE, candidates.filter((m) => hidden.has(m.id)).length),
    hits,
  }
}

/** One row per list and a total row: hits in the batch of 20 per variant, as count and hit rate (hits / 20). */
export function markdownTable(results: readonly UserResult[]): string {
  const names = VARIANTS.map((v) => v.name)
  const cell = (hits: number, of: number) => `${hits} (${((100 * hits) / of).toFixed(0)}%)`
  const lines = [
    `| List | Watched | Hidden | Candidates | Reachable | ${names.join(' | ')} |`,
    `|---|---:|---:|---:|---:|${names.map(() => '---:').join('|')}|`,
    ...results.map(
      (r) =>
        `| ${r.userName} | ${r.watched} | ${r.hidden} | ${r.candidates} | ${r.reachable} | ${names
          .map((n) => cell(r.hits[n], BATCH_SIZE))
          .join(' | ')} |`,
    ),
  ]
  if (results.length > 1) {
    const total = (n: string) => results.reduce((sum, r) => sum + r.hits[n], 0)
    lines.push(
      `| **Total** | ${results.reduce((s, r) => s + r.watched, 0)} | ${results.reduce((s, r) => s + r.hidden, 0)} | | ${results.reduce((s, r) => s + r.reachable, 0)} | ${names
        .map((n) => `**${cell(total(n), BATCH_SIZE * results.length)}**`)
        .join(' | ')} |`,
    )
  }
  return lines.join('\n')
}

/** Evaluates each list in turn; a list that fails (private, missing user) is reported and skipped. */
export async function runEval(deps: EvalDeps, userNames: readonly string[], seed: number): Promise<string> {
  const fetchFn = rateLimitedFetch(deps)
  const results: UserResult[] = []
  for (const userName of userNames) {
    try {
      results.push(await evaluateUser(deps, fetchFn, userName, seed))
    } catch (error) {
      if (!(error instanceof AniListError)) throw error
      deps.log(`${userName}: skipped (${error.kind}: ${error.message})`)
    }
  }
  const weights = VARIANTS.map(
    (v) =>
      `- **${v.name}**: relations ${v.weights.relations} / recommendations ${v.weights.recommendations} / popularity ${v.weights.popularity} / tags ${v.weights.tags}`,
  )
  return [
    `Hidden titles in the batch of ${BATCH_SIZE} (hit rate = hits / ${BATCH_SIZE}). ${HOLDOUT_SHARE * 100}% of each watched list hidden, seed ${seed}. Reachable = hidden titles present in the candidate pool at all.`,
    '',
    markdownTable(results),
    '',
    ...weights,
  ].join('\n')
}
