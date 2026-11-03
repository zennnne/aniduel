// Catch-up suggestions: picks the next batch of anime or manga the user has probably already watched. Pure:
// the same input and seed always give the same batch. See docs/research/onboarding-recall-recommendation.md for the
// signals.
import type { CatchUpMedia, Era } from '../anilist/candidates.ts'
import type { ListEntry, MediaType } from '../anilist/types.ts'
import { isNearEmpty } from './entry.ts'
import { isWatched } from './watched.ts'

/** How much each signal counts in a candidate's strength. */
export type CatchUpWeights = {
  /** Sequel, prequel and other relation links to watched titles. */
  relations: number
  /** AniList community recommendations from watched titles, by rating. */
  recommendations: number
  /** Watched-popularity (not counting Planning) × the user's era × the user's formats. */
  popularity: number
  /** Tag overlap with watched titles: a small tie-breaker only. */
  tags: number
  /** Manga only: links from the anime the user liked to their manga source (`AnimeSignal`). Zero for anime. */
  animeSignal: number
}

/**
 * The weights each Media Type's suggestions use. Anime's were locked by the holdout eval (#44): 55% of hidden titles in
 * the top 20, against 24% for popularity alone. Manga's were picked on #95 from its own eval (#96): anime's, the anime
 * signal off, at 26% of hidden titles against 19% for popularity alone. The signal at 0.2 reached 29%, but from two of
 * six lists only, and lost on the mainly-webtoon one.
 */
export const CATCH_UP_WEIGHTS: Readonly<Record<MediaType, Readonly<CatchUpWeights>>> = {
  ANIME: { relations: 0.45, recommendations: 0.3, popularity: 0.25, tags: 0.05, animeSignal: 0 },
  MANGA: { relations: 0.45, recommendations: 0.3, popularity: 0.25, tags: 0.05, animeSignal: 0 },
}

/**
 * Manga Catch-up's weak signal from the user's anime: each Completed or Repeating anime passes strength to the manga it
 * is adapted from (or that was adapted from it), by how the user liked it.
 */
export type AnimeSignal = {
  /** The user's whole anime list. Only Completed and Repeating count; the scores of every status set the mean. */
  list: ReadonlyArray<Pick<ListEntry, 'mediaId' | 'status' | 'oldScore100'>>
  /** The user's favourite anime. */
  favourites: ReadonlySet<number>
  /**
   * The anime's own SOURCE / ADAPTATION links where loaded: anime id → manga ids. The manga's links to their anime come
   * from `CatchUpInput.media`; either side alone is enough.
   */
  adaptations?: ReadonlyMap<number, readonly number[]>
}

export type CatchUpInput = {
  /** What is suggested: the Media Type of `list` and `media`. Defaults to anime. */
  mediaType?: MediaType
  /** The user's whole list, every status. Planning entries are excluded but don't count as watched. */
  list: ReadonlyArray<Pick<ListEntry, 'mediaId' | 'status' | 'year' | 'format'>>
  /**
   * What's known about the titles: the watched ones (for their relations, recommendations, tags and country) and the
   * candidates to choose from. Anything here that isn't on the list may be suggested.
   */
  media: readonly CatchUpMedia[]
  /** Passed history: media id → when it was last Passed (ms since epoch). */
  passed: ReadonlyMap<number, number>
  /** Ms since epoch. */
  now: number
  /** Picks the exploratory titles; the same seed gives the same batch. */
  seed: number
  /** Defaults to the Media Type's CATCH_UP_WEIGHTS; the holdout eval passes its variants here. */
  weights?: CatchUpWeights
  /**
   * The Starting era, used only while the list is near empty (`isNearEmpty`): the batch is then the
   * most popular titles from it. Null or left out gives all-time favourites.
   */
  startingEra?: Era | null
  /** Manga only: the user's anime, weighed by `weights.animeSignal`. Left out, or at weight zero, it changes nothing. */
  anime?: AnimeSignal
  /**
   * Below this many watched titles the list is near empty. Defaults to the Media Type's NEAR_EMPTY_BELOW; the holdout
   * eval lowers it to score short lists the full way.
   */
  nearEmptyBelow?: number
}

/**
 * Why a title is in the batch: `strong` (the strongest matches overall), `era` (popular in the user's years and
 * formats) or `explore` (popular outside them).
 */
export type SuggestionKind = 'strong' | 'era' | 'explore'

export type Suggestion = { media: CatchUpMedia; kind: SuggestionKind }

/** How long a Passed title stays out of suggestions. */
export const PASSED_HIDE_MS = 30 * 24 * 60 * 60 * 1000

export const BATCH_SIZE = 20

/** How many of each kind a batch has when there are enough candidates; any shortfall is filled by the strongest. */
export const BATCH_COMPOSITION: Readonly<Record<SuggestionKind, number>> = { strong: 12, era: 5, explore: 3 }

/** At most this many titles from one franchise in a batch. */
export const MAX_PER_FRANCHISE = 2

/** A candidate is in the user's era when watched titles started within this many years of it. */
const ERA_SPAN_YEARS = 2

/** Exploratory titles are drawn at random from this many times as many of the best-ranked. */
const EXPLORE_POOL_FACTOR = 4

/** Trade-off between rank and novelty when picking each next title (maximal marginal relevance). */
const DIVERSITY_LAMBDA = 0.7

/** How much more a Repeating anime and a favourite anime count in the anime signal than a Completed one. */
const REPEATING_FACTOR = 1.5
const FAVOURITE_FACTOR = 2

/** How much one anime counts at most for its score: at the user's mean it counts 1, one deviation above it 2. */
const MAX_SCORE_FACTOR = 2

/** Relations too loose to make two titles one franchise. */
const NOT_FRANCHISE = new Set(['CHARACTER', 'OTHER'])

/** The same link seen from the other title's side: if A lists B as its SEQUEL, B has A as its PREQUEL. */
const INVERSE: Record<string, string> = {
  SEQUEL: 'PREQUEL',
  PREQUEL: 'SEQUEL',
  PARENT: 'SIDE_STORY',
  SIDE_STORY: 'PARENT',
}

/**
 * How likely a candidate is watched, given that a watched title has it as this relation. Every watched status counts
 * the same, Dropped included: the question is "seen it?", not "liked it?".
 */
function relationStrength(type: string): number {
  switch (type) {
    case 'PREQUEL':
    case 'PARENT':
      return 1
    case 'SEQUEL':
      return 0.8
    case 'SIDE_STORY':
    case 'SPIN_OFF':
      return 0.4
    case 'SUMMARY':
    case 'COMPILATION':
    case 'ALTERNATIVE':
      return 0.2
    default:
      return 0
  }
}

/** Franchise of every media id: titles joined by relations, through any chain of them. */
function franchises(media: readonly CatchUpMedia[]): (id: number) => number {
  const parent = new Map<number, number>()
  const root = (id: number): number => {
    const p = parent.get(id)
    if (p === undefined || p === id) return id
    const r = root(p)
    parent.set(id, r)
    return r
  }
  for (const m of media) {
    for (const r of m.relations) {
      if (NOT_FRANCHISE.has(r.type)) continue
      const a = root(m.id)
      const b = root(r.mediaId)
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b))
    }
  }
  return root
}

/** Tag-set overlap of two titles, 0–1. */
function tagSimilarity(a: CatchUpMedia, b: CatchUpMedia): number {
  if (a.tags.length === 0 || b.tags.length === 0) return 0
  const names = new Set(a.tags.map((t) => t.name))
  const shared = b.tags.filter((t) => names.has(t.name)).length
  return shared / (names.size + b.tags.length - shared)
}

/**
 * How much each liked anime counts: Completed and Repeating only, by its score against the user's own mean, more when
 * Repeating and when a favourite. The score scales it smoothly: 1 at the mean (and unscored), 2 at one deviation above
 * it or more, falling to nothing at one deviation below it, so a title a little under the mean still counts a little.
 */
function animeWeights(signal: AnimeSignal): Map<number, number> {
  const scores = signal.list.filter((e) => e.oldScore100 > 0).map((e) => e.oldScore100)
  const mean = scores.reduce((sum, x) => sum + x, 0) / Math.max(1, scores.length)
  const deviation = Math.sqrt(scores.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, scores.length))
  const weights = new Map<number, number>()
  for (const e of signal.list) {
    if (e.status !== 'COMPLETED' && e.status !== 'REPEATING') continue
    const z = e.oldScore100 > 0 && deviation > 0 ? (e.oldScore100 - mean) / deviation : 0
    let weight = Math.min(MAX_SCORE_FACTOR, Math.max(0, 1 + z))
    if (e.status === 'REPEATING') weight *= REPEATING_FACTOR
    if (signal.favourites.has(e.mediaId)) weight *= FAVOURITE_FACTOR
    if (weight > 0) weights.set(e.mediaId, weight)
  }
  return weights
}

/** mulberry32: a small seeded PRNG giving numbers in [0, 1). */
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

/** The next batch of up to BATCH_SIZE titles, strongest matches first, then popular-in-era, then exploratory. */
export function suggestCatchUp(input: CatchUpInput): Suggestion[] {
  const mediaType = input.mediaType ?? 'ANIME'
  const weights = input.weights ?? CATCH_UP_WEIGHTS[mediaType]
  const listed = new Set(input.list.map((e) => e.mediaId))
  const watched = new Set(input.list.filter(isWatched).map((e) => e.mediaId))
  const hidden = (id: number) => {
    const at = input.passed.get(id)
    return at !== undefined && input.now - at < PASSED_HIDE_MS
  }

  // Relations: the strongest link from any watched title, whichever side lists the edge.
  // Recommendations: log net votes summed over every watched title recommending the candidate.
  // Tags: how strongly each tag runs through the watched titles.
  const relation = new Map<number, number>()
  const link = (candidate: number, type: string, seed: number) => {
    if (watched.has(seed)) relation.set(candidate, Math.max(relation.get(candidate) ?? 0, relationStrength(type)))
  }
  const votes = new Map<number, number>()
  const tagProfile = new Map<string, number>()
  for (const m of input.media) {
    for (const r of m.relations) {
      link(r.mediaId, r.type, m.id)
      link(m.id, INVERSE[r.type] ?? r.type, r.mediaId)
    }
    if (!watched.has(m.id)) continue
    for (const r of m.recommendations) {
      if (r.rating > 0) votes.set(r.mediaId, (votes.get(r.mediaId) ?? 0) + Math.log1p(r.rating))
    }
    for (const t of m.tags) tagProfile.set(t.name, (tagProfile.get(t.name) ?? 0) + t.rank / 100)
  }
  const maxTag = Math.max(0, ...tagProfile.values())

  // Anime signal: the summed weight of the liked anime linked to each manga, from either side of the link.
  const fromAnime = new Map<number, number>()
  if (input.anime && weights.animeSignal > 0) {
    const liked = animeWeights(input.anime)
    const links = new Map<number, Set<number>>()
    const join = (manga: number, anime: number) => {
      if (liked.has(anime)) links.set(manga, (links.get(manga) ?? new Set()).add(anime))
    }
    for (const m of input.media) for (const a of m.adaptations) join(m.id, a)
    for (const [a, mangaIds] of input.anime.adaptations ?? []) for (const id of mangaIds) join(id, a)
    for (const [manga, anime] of links) fromAnime.set(manga, [...anime].reduce((sum, a) => sum + liked.get(a)!, 0))
  }

  // Era and format fit, each 0–1: how much of the watched list is near the candidate's year, and in its format. Manga
  // fits format and country together (a Korean MANGA is a manhwa), the country taken from the loaded titles.
  const country = new Map(input.media.map((m) => [m.id, m.country]))
  const formatKey = (id: number, format: string | null) =>
    format === null ? null : mediaType === 'MANGA' ? `${format}·${country.get(id) ?? '?'}` : format
  const watchedEntries = input.list
    .filter((e) => watched.has(e.mediaId))
    .map((e) => ({ year: e.year, format: formatKey(e.mediaId, e.format) }))
  const nearYear = (year: number | null) =>
    year === null
      ? 0
      : watchedEntries.filter((e) => e.year !== null && Math.abs(e.year - year) <= ERA_SPAN_YEARS).length
  const sameFormat = (format: string | null) => watchedEntries.filter((e) => e.format === format).length
  const maxNearYear = Math.max(1, ...watchedEntries.map((e) => nearYear(e.year)))
  const maxSameFormat = Math.max(1, ...watchedEntries.map((e) => sameFormat(e.format)))

  const candidates = input.media.filter(
    (m) => !listed.has(m.id) && !hidden(m.id) && m.status !== 'NOT_YET_RELEASED',
  )
  const maxWatched = Math.max(1, ...candidates.map((m) => m.watched))

  // Starting era fit, 0–1: 1 inside it (or with no Starting era), falling off with the years outside it.
  const startingEra = input.startingEra ?? null
  const startingEraFit = (year: number | null) => {
    if (startingEra === null) return 1
    if (year === null) return 0
    const off = Math.max(0, startingEra.from - year, year - startingEra.to)
    return 1 / (1 + off / ERA_SPAN_YEARS)
  }

  const signals = new Map(
    candidates.map((m) => {
      const era = nearYear(m.year) / maxNearYear
      const format = formatKey(m.id, m.format)
      const formatFit = format === null ? 0 : sameFormat(format) / maxSameFormat
      const popularity = Math.log1p(m.watched) / Math.log1p(maxWatched)
      const popularInEra = popularity * (0.5 + 0.5 * era) * (0.5 + 0.5 * formatFit)
      const tagWeight = m.tags.reduce((sum, t) => sum + t.rank / 100, 0)
      const tagFit =
        maxTag === 0 || tagWeight === 0
          ? 0
          : m.tags.reduce((sum, t) => sum + (t.rank / 100) * (tagProfile.get(t.name) ?? 0), 0) / (tagWeight * maxTag)
      const strength =
        weights.relations * (relation.get(m.id) ?? 0) +
        weights.recommendations * (1 - Math.exp(-(votes.get(m.id) ?? 0) / 6)) +
        weights.popularity * popularInEra +
        weights.tags * tagFit +
        weights.animeSignal * (1 - Math.exp(-(fromAnime.get(m.id) ?? 0)))
      const fromStartingEra = popularity * startingEraFit(m.year)
      return [m.id, { strength, popularInEra, outsideEra: popularity * (1 - era * formatFit), fromStartingEra }]
    }),
  )

  const franchise = franchises(input.media)
  const perFranchise = new Map<number, number>()
  const batch: Suggestion[] = []
  const left = new Set(candidates)
  const next = random(input.seed)

  /** Adds up to `count` of `pool` in rank order, skipping full franchises and spreading out similar titles. */
  const take = (kind: SuggestionKind, count: number, pool: CatchUpMedia[], rank: (m: CatchUpMedia) => number) => {
    const open = pool.filter((m) => left.has(m))
    for (let added = 0; added < count; added++) {
      let best: CatchUpMedia | null = null
      let bestValue = -Infinity
      for (const m of open) {
        if (!left.has(m) || (perFranchise.get(franchise(m.id)) ?? 0) >= MAX_PER_FRANCHISE) continue
        const similarity = Math.max(0, ...batch.map((s) => tagSimilarity(m, s.media)))
        const value = DIVERSITY_LAMBDA * rank(m) - (1 - DIVERSITY_LAMBDA) * similarity
        if (value > bestValue) {
          best = m
          bestValue = value
        }
      }
      if (!best) return
      left.delete(best)
      perFranchise.set(franchise(best.id), (perFranchise.get(franchise(best.id)) ?? 0) + 1)
      batch.push({ media: best, kind })
    }
  }
  const byRank = (rank: (m: CatchUpMedia) => number) => (ms: CatchUpMedia[]) =>
    ms.sort((a, b) => rank(b) - rank(a) || a.id - b.id)
  const strength = (m: CatchUpMedia) => signals.get(m.id)!.strength
  const popularInEra = (m: CatchUpMedia) => signals.get(m.id)!.popularInEra
  const outsideEra = (m: CatchUpMedia) => signals.get(m.id)!.outsideEra
  const fromStartingEra = (m: CatchUpMedia) => signals.get(m.id)!.fromStartingEra

  if (isNearEmpty(input.list, mediaType, input.nearEmptyBelow)) {
    take('era', BATCH_SIZE, byRank(fromStartingEra)([...left]), fromStartingEra)
    return batch
  }

  take('strong', BATCH_COMPOSITION.strong, byRank(strength)([...left]), strength)
  take('era', BATCH_COMPOSITION.era, byRank(popularInEra)([...left]), popularInEra)
  // Exploratory titles: a seeded draw from the most popular titles outside the user's usual years and formats.
  const explorePool = byRank(outsideEra)([...left].filter((m) => outsideEra(m) > 0))
    .slice(0, BATCH_COMPOSITION.explore * EXPLORE_POOL_FACTOR)
    .map((m) => ({ m, key: next() }))
    .sort((a, b) => a.key - b.key)
    .map(({ m }) => m)
  take('explore', BATCH_COMPOSITION.explore, explorePool, () => 1)
  take('strong', BATCH_SIZE - batch.length, byRank(strength)([...left]), strength)
  return batch
}
