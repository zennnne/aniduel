import type { ListEntry, MediaType, TitleLanguage } from '../anilist/types.ts'
import type { SortGoal } from '../ranking/engine.ts'
import { displayTitle } from '../pool/pool.ts'

/** "2016 · TV · 12 eps": year · format, plus the length unless it is a movie or unknown. */
export function metaLine(entry: ListEntry, mediaType: MediaType): string {
  const parts: string[] = []
  if (entry.year) parts.push(String(entry.year))
  if (entry.format) parts.push(entry.format.replace(/_/g, ' '))
  if (entry.length && entry.format !== 'MOVIE') parts.push(`${entry.length} ${mediaType === 'MANGA' ? 'ch' : 'eps'}`)
  return parts.join(' · ')
}

/** How a Media Type is named in the UI. */
export const MEDIA_LABEL: Record<MediaType, string> = { ANIME: 'Anime', MANGA: 'Manga' }

/** How a Sort Goal is named in the UI: the Sort Goal `seg`'s buttons and the dialogs that name a saved Ranking's goal. */
export const SORT_GOAL_LABEL: Record<SortGoal, string> = { scores: 'Scores', 'full-ranking': 'Full Ranking', 'score-new-titles': 'New Titles' }

/** A title's name in the user's Title Language, or "Title #id" while its list entry isn't loaded (e.g. AniList unreachable). */
export function titleName(entry: ListEntry | undefined, id: number, titleLanguage: TitleLanguage): string {
  return entry ? displayTitle(entry.title, titleLanguage) : `Title #${id}`
}

/** `word`, or its plural (default `word` + "s") unless there is exactly one. */
export function pluralWord(n: number, word: string, plural = `${word}s`): string {
  return n === 1 ? word : plural
}

/** "1 Duel", "3 Duels". */
export function count(n: number, word: string, plural?: string): string {
  return `${n} ${pluralWord(n, word, plural)}`
}
