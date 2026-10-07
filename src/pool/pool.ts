// Pool: the titles from one user's list (one Media Type, filtered by list status) being ranked.
import type { ListEntry, ListStatus, Title, TitleLanguage } from '../anilist/types.ts'
import { duelsForBandSizes, equalBandSizes } from '../ranking/estimate.ts'
import type { SavedScoring } from '../ranking/scoring.ts'

/** Statuses the user can pick, in display order. Planning is never offered: those titles were never watched or read. */
export const OFFERED_STATUSES = ['COMPLETED', 'REPEATING', 'CURRENT', 'PAUSED', 'DROPPED'] as const satisfies readonly ListStatus[]

export type OfferedStatus = (typeof OFFERED_STATUSES)[number]

export const DEFAULT_STATUSES: readonly OfferedStatus[] = ['COMPLETED', 'REPEATING']

/** A title's name in the user's title language, falling back to romaji. */
export function displayTitle(title: Title, language: TitleLanguage): string {
  if (language.startsWith('ENGLISH')) return title.english ?? title.romaji
  if (language.startsWith('NATIVE')) return title.native ?? title.romaji
  return title.romaji
}

/**
 * Expected Duels for a Pool of `n` titles before Rough Sort, assuming five equal Bands: on Full Ranking, or on
 * Scores with the given scoring settings (ADR 0007).
 */
export function estimateDuels(n: number, scale?: SavedScoring): number {
  return duelsForBandSizes(equalBandSizes(n), scale)
}

const SECONDS_PER_DUEL = 3

export function estimateMinutes(duels: number): number {
  return Math.round((duels * SECONDS_PER_DUEL) / 60)
}

/** Sort key for a completion date; missing month/day sort before any known one in that year. null = undated. */
function completedKey(entry: ListEntry): number | null {
  const { year, month, day } = entry.completedAt
  if (year === null) return null
  return year * 10000 + (month ?? 0) * 100 + (day ?? 0)
}

/**
 * The order Rough Sort shows titles in (issue #4): most recently completed first, undated titles last,
 * sorted by the name the user sees. Returns media ids, ready for a `titles-added` event.
 */
export function roughSortOrder(entries: readonly ListEntry[], language: TitleLanguage): number[] {
  const byName = (a: ListEntry, b: ListEntry) =>
    displayTitle(a.title, language).localeCompare(displayTitle(b.title, language))
  return [...entries]
    .sort((a, b) => {
      const ka = completedKey(a)
      const kb = completedKey(b)
      if (ka === null || kb === null) return ka === kb ? byName(a, b) : ka === null ? 1 : -1
      return kb - ka || byName(a, b)
    })
    .map((entry) => entry.mediaId)
}

export type Pool = {
  titles: ListEntry[]
  countByStatus: Record<OfferedStatus, number>
  expectedDuels: number
}

/**
 * Builds the Pool from the user's list (fetched for every offered status) and the chosen statuses. `scale`: the
 * estimate is for Scores with those settings (a new Ranking starts on Scores), else for Full Ranking.
 */
export function buildPool(list: readonly ListEntry[], statuses: readonly ListStatus[], scale?: SavedScoring): Pool {
  const countByStatus = Object.fromEntries(OFFERED_STATUSES.map((s) => [s, 0])) as Record<OfferedStatus, number>
  for (const entry of list) {
    if (entry.status in countByStatus) countByStatus[entry.status as OfferedStatus]++
  }
  const chosen = new Set(statuses)
  const titles = list.filter((entry) => chosen.has(entry.status))
  return { titles, countByStatus, expectedDuels: estimateDuels(titles.length, scale) }
}
