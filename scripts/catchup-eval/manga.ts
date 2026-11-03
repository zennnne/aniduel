// Holdout eval for the manga Catch-up weights and near-empty threshold (#96): like the anime eval (#44), on public
// manga lists, with the user's anime list feeding the anime signal. A throwaway prototype, kept out of the test suite;
// it reuses the suggestion module and the candidate query rather than copying them.
import { fetchCatchUpMedia, fetchPopularMedia, type CatchUpMedia, type Era } from '../../src/anilist/candidates.ts'
import { AniListError, request } from '../../src/anilist/gateway.ts'
import { eraYears } from '../../src/catchup/suggestionCandidates.ts'
import { isWatched } from '../../src/catchup/watched.ts'
import { BATCH_SIZE, CATCH_UP_WEIGHTS, suggestCatchUp, type AnimeSignal } from '../../src/catchup/suggest.ts'
import {
  describeWeights,
  fetchPublicList,
  holdout,
  rateLimitedFetch,
  type EvalDeps,
  type EvalEntry,
  type Variant,
} from './holdout.ts'

const ANIME_WEIGHTS = CATCH_UP_WEIGHTS.ANIME

/** Decided on #95: the anime weights, with the anime signal at three strengths, popularity only, recommendations ±1 step. */
export const MANGA_VARIANTS: readonly Variant[] = [
  { name: 'anime weights', weights: { ...ANIME_WEIGHTS, anime: 0 } },
  { name: 'anime signal 0.05', weights: { ...ANIME_WEIGHTS, anime: 0.05 } },
  { name: 'anime signal 0.10', weights: { ...ANIME_WEIGHTS, anime: 0.1 } },
  { name: 'anime signal 0.20', weights: { ...ANIME_WEIGHTS, anime: 0.2 } },
  { name: 'popularity only', weights: { relations: 0, recommendations: 0, popularity: 1, tags: 0, anime: 0 } },
  { name: 'recommendations 0.2', weights: { ...ANIME_WEIGHTS, recommendations: 0.2, anime: 0 } },
  { name: 'recommendations 0.4', weights: { ...ANIME_WEIGHTS, recommendations: 0.4, anime: 0 } },
]

/** Watched-list sizes the near-empty threshold is chosen from (#95). */
export const THRESHOLD_SIZES = [10, 15, 20, 30] as const

/** Pages of 50 popular manga fetched from the user's era, standing in for Catch-up's popular-in-era candidates. */
const ERA_PAGES = 2

const FAVOURITES_QUERY = `query ($userName: String, $page: Int) {
  User(name: $userName) {
    favourites { anime(page: $page, perPage: 25) { pageInfo { hasNextPage } nodes { id } } }
  }
}`

type RawFavourites = {
  User: { favourites: { anime: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ id: number }> } } }
}

/** A user's public favourite anime. */
async function fetchFavouriteAnime(fetchFn: typeof fetch, userName: string): Promise<Set<number>> {
  const ids = new Set<number>()
  for (let page = 1; ; page++) {
    const data = await request<RawFavourites>({ fetch: fetchFn, token: null }, FAVOURITES_QUERY, { userName, page })
    for (const n of data.User.favourites.anime.nodes) ids.add(n.id)
    if (!data.User.favourites.anime.pageInfo.hasNextPage) break
  }
  return ids
}

/** Hits per variant for one scenario: a visible list, the titles hidden from it, and the candidates it calls for. */
type Scenario = { hits: Record<string, number>; hidden: number; reachable: number }

export type MangaUserResult = {
  userName: string
  watched: number
  /** Share of the visible read manga that is Korean, Chinese or Taiwanese (manhwa, manhua). */
  webtoonShare: number
  animeLiked: number
  holdout: Scenario & { candidates: number }
  /** Watched-list size → the run truncated to that many visible read titles. */
  sizes: Record<number, Scenario>
}

/** Everything fetched for one user, cached by id so the truncated runs ask AniList only for what's new. */
async function evaluateUser(deps: EvalDeps, fetchFn: typeof fetch, userName: string, seed: number): Promise<MangaUserResult> {
  const read = { fetch: fetchFn, token: null }
  const list = await fetchPublicList(fetchFn, userName, 'MANGA')
  const animeList = await fetchPublicList(fetchFn, userName, 'ANIME')
  const favourites = await fetchFavouriteAnime(fetchFn, userName)
  const { visible, hidden } = holdout(list, seed)
  const watchedVisible = visible.filter(isWatched)
  deps.log(`${userName}: ${list.filter(isWatched).length} read manga (${hidden.size} hidden), ${animeList.length} anime`)

  const known = new Map<number, CatchUpMedia>()
  const asked = new Set<number>()
  const load = async (ids: Iterable<number>) => {
    const missing = [...new Set(ids)].filter((id) => !asked.has(id))
    for (const id of missing) asked.add(id)
    if (missing.length === 0) return
    for (const m of await fetchCatchUpMedia(read, missing, 'MANGA')) known.set(m.id, m)
  }
  const popularByEra = new Map<string, CatchUpMedia[]>()
  const popular = async (era: Era | null) => {
    const key = JSON.stringify(era)
    if (!popularByEra.has(key)) {
      const media = era ? await fetchPopularMedia(read, 'MANGA', era, ERA_PAGES) : []
      for (const m of media) known.set(m.id, m)
      popularByEra.set(key, media)
    }
    return popularByEra.get(key)!
  }

  // The anime signal: the liked anime and their links to manga, from the anime's side.
  const likedIds = animeList.filter((e) => e.status === 'COMPLETED' || e.status === 'REPEATING').map((e) => e.mediaId)
  deps.log(`${userName}: fetching ${likedIds.length} Completed / Repeating anime for their manga links`)
  const animeMedia = await fetchCatchUpMedia(read, likedIds, 'ANIME')
  const adaptations = new Map(animeMedia.map((a) => [a.id, a.adaptations]))
  const animeSignal: AnimeSignal = { list: animeList, favourites, adaptations }
  const fromAnime = new Set(animeMedia.flatMap((a) => a.adaptations))

  deps.log(`${userName}: fetching ${watchedVisible.length} seeds`)
  await load(watchedVisible.map((e) => e.mediaId))
  const neighbours = (seeds: readonly EvalEntry[]) => {
    const ids = new Set<number>()
    for (const e of seeds) {
      const m = known.get(e.mediaId)
      if (!m) continue
      for (const r of m.relations) ids.add(r.mediaId)
      for (const r of m.recommendations) ids.add(r.mediaId)
    }
    return ids
  }
  const allNeighbours = neighbours(watchedVisible)
  deps.log(`${userName}: fetching ${allNeighbours.size + fromAnime.size} candidates`)
  await load([...allNeighbours, ...fromAnime])

  /** Runs every variant on `visibleList`, with the candidates its read titles call for. */
  const run = async (visibleList: readonly EvalEntry[], hiddenIds: ReadonlySet<number>, nearEmptyBelow?: number) => {
    const seeds = visibleList.filter(isWatched)
    const ids = new Set([...seeds.map((e) => e.mediaId), ...neighbours(seeds), ...fromAnime])
    const media = [
      ...new Map(
        [...[...ids].flatMap((id) => known.get(id) ?? []), ...(await popular(eraYears(visibleList)))].map((m) => [m.id, m]),
      ).values(),
    ]
    const hits: Record<string, number> = {}
    for (const variant of MANGA_VARIANTS) {
      const batch = suggestCatchUp({
        mediaType: 'MANGA',
        list: visibleList,
        media,
        passed: new Map(),
        now: 0,
        seed,
        weights: variant.weights,
        anime: animeSignal,
        nearEmptyBelow,
      })
      hits[variant.name] = batch.filter((s) => hiddenIds.has(s.media.id)).length
    }
    const onList = new Set(visibleList.map((e) => e.mediaId))
    const candidates = media.filter((m) => !onList.has(m.id))
    return {
      hits,
      hidden: hiddenIds.size,
      reachable: Math.min(BATCH_SIZE, candidates.filter((m) => hiddenIds.has(m.id)).length),
      candidates: candidates.length,
    }
  }

  const full = await run(visible, hidden)

  // Truncated lists: the first N read titles of the visible list in a seeded order stay; every other read title is
  // hidden. Near-empty is turned off so the weights run the full way.
  const order = [...watchedVisible].sort((a, b) => hash(a.mediaId, seed) - hash(b.mediaId, seed) || a.mediaId - b.mediaId)
  const notWatched = visible.filter((e) => !isWatched(e))
  const sizes: Record<number, Scenario> = {}
  for (const size of THRESHOLD_SIZES) {
    if (order.length < size) continue
    const kept = order.slice(0, size)
    const keptIds = new Set(kept.map((e) => e.mediaId))
    const hiddenIds = new Set(list.filter((e) => isWatched(e) && !keptIds.has(e.mediaId)).map((e) => e.mediaId))
    sizes[size] = await run([...kept, ...notWatched], hiddenIds, 0)
  }

  const loaded = watchedVisible.flatMap((e) => known.get(e.mediaId) ?? [])
  const webtoons = loaded.filter((m) => m.country === 'KR' || m.country === 'CN' || m.country === 'TW').length
  return {
    userName,
    watched: list.filter(isWatched).length,
    webtoonShare: webtoons / Math.max(1, loaded.length),
    animeLiked: likedIds.length,
    holdout: full,
    sizes,
  }
}

/** A 32-bit integer hash of an id and a seed: a seeded order unrelated to popularity or year. */
function hash(id: number, seed: number): number {
  let h = Math.imul(id ^ seed, 0x9e3779b1)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return h >>> 0
}

const pct = (hits: number, of: number) => `${hits} (${((100 * hits) / of).toFixed(0)}%)`

/** The holdout table, the threshold table, and the weights of each variant, as Markdown. */
export function mangaReport(results: readonly MangaUserResult[], seed: number): string {
  const names = MANGA_VARIANTS.map((v) => v.name)
  const holdoutRows = results.map(
    (r) =>
      `| ${r.userName} | ${r.watched} | ${(100 * r.webtoonShare).toFixed(0)}% | ${r.animeLiked} | ${r.holdout.hidden} | ${r.holdout.candidates} | ${r.holdout.reachable} | ${names
        .map((n) => pct(r.holdout.hits[n], BATCH_SIZE))
        .join(' | ')} |`,
  )
  const total = (n: string) => results.reduce((sum, r) => sum + r.holdout.hits[n], 0)
  const holdoutTable = [
    `| List | Read | KR/CN | Anime liked | Hidden | Candidates | Reachable | ${names.join(' | ')} |`,
    `|---|---:|---:|---:|---:|---:|---:|${names.map(() => '---:').join('|')}|`,
    ...holdoutRows,
    `| **Total** | ${results.reduce((s, r) => s + r.watched, 0)} | | | ${results.reduce((s, r) => s + r.holdout.hidden, 0)} | | ${results.reduce((s, r) => s + r.holdout.reachable, 0)} | ${names
      .map((n) => `**${pct(total(n), BATCH_SIZE * results.length)}**`)
      .join(' | ')} |`,
  ]

  const sizeRows = THRESHOLD_SIZES.map((size) => {
    const runs = results.flatMap((r) => r.sizes[size] ?? [])
    const of = BATCH_SIZE * runs.length
    const sum = (n: string) => runs.reduce((s, r) => s + r.hits[n], 0)
    const popularity = sum('popularity only')
    const lead = (n: string) => (of === 0 ? '' : ` ${(100 * (sum(n) - popularity)) / of >= 0 ? '+' : ''}${((100 * (sum(n) - popularity)) / of).toFixed(0)}`)
    return `| ${size} | ${runs.length} | ${names.map((n) => (of === 0 ? '–' : `${pct(sum(n), of)}${n === 'popularity only' ? '' : lead(n)}`)).join(' | ')} |`
  })
  const sizeTable = [
    `| Read titles kept | Lists | ${names.join(' | ')} |`,
    `|---:|---:|${names.map(() => '---:').join('|')}|`,
    ...sizeRows,
  ]

  return [
    `**Holdout**: ${20}% of each read list hidden, seed ${seed}; hits = hidden titles in the batch of ${BATCH_SIZE}. Reachable = hidden titles among the candidates at all. KR/CN = share of the read manga that is Korean or Chinese.`,
    '',
    ...holdoutTable,
    '',
    `**Threshold**: each list cut to N read titles (a seeded draw from the visible ones), every other read title hidden, near-empty off so the weights run the full way. Hits summed over the lists; the number after each = points ahead of popularity only.`,
    '',
    ...sizeTable,
    '',
    ...MANGA_VARIANTS.map((v) => `- **${v.name}**: ${describeWeights(v.weights)}`),
  ].join('\n')
}

/** Evaluates each list in turn; a list that fails (private, missing user) is reported and skipped. */
export async function runMangaEval(deps: EvalDeps, userNames: readonly string[], seed: number): Promise<string> {
  const fetchFn = rateLimitedFetch(deps)
  const results: MangaUserResult[] = []
  for (const userName of userNames) {
    try {
      results.push(await evaluateUser(deps, fetchFn, userName, seed))
    } catch (error) {
      if (!(error instanceof AniListError)) throw error
      deps.log(`${userName}: skipped (${error.kind}: ${error.message})`)
    }
  }
  return mangaReport(results, seed)
}
