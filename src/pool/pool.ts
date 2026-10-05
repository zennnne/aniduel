// Pool: the titles from one user's list (one Media Type, filtered by list status) being ranked.
import type { ListEntry, ListStatus, Title, TitleLanguage } from '../anilist/types.ts'
import { duelsForBandSizes, equalBandSizes } from '../ranking/estimate.ts'

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

/** Expected Duels for a Pool of `n` titles before Rough Sort, assuming five equal Bands. */
export function estimateDuels(n: number): number {
  return duelsForBandSizes(equalBandSizes(n))
}

const SECONDS_PER_DUEL = 3

export function estimateMinutes(duels: number): number {
  return Math.round((duels * SECONDS_PER_DUEL) / 60)
}

export type Pool = {
  titles: ListEntry[]
  countByStatus: Record<OfferedStatus, number>
  expectedDuels: number
}

/** Builds the Pool from the user's list (fetched for every offered status) and the chosen statuses. */
export function buildPool(list: readonly ListEntry[], statuses: readonly ListStatus[]): Pool {
  const countByStatus = Object.fromEntries(OFFERED_STATUSES.map((s) => [s, 0])) as Record<OfferedStatus, number>
  for (const entry of list) {
    if (entry.status in countByStatus) countByStatus[entry.status as OfferedStatus]++
  }
  const chosen = new Set(statuses)
  const titles = list.filter((entry) => chosen.has(entry.status))
  return { titles, countByStatus, expectedDuels: estimateDuels(titles.length) }
}
