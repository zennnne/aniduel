import type { ListEntry, MediaType } from '../anilist/types.ts'

/** "2016 · TV · 12 eps": year · format, plus the length unless it is a movie or unknown. */
export function metaLine(entry: ListEntry, mediaType: MediaType): string {
  const parts: string[] = []
  if (entry.year) parts.push(String(entry.year))
  if (entry.format) parts.push(entry.format.replace(/_/g, ' '))
  if (entry.length && entry.format !== 'MOVIE') parts.push(`${entry.length} ${mediaType === 'MANGA' ? 'ch' : 'eps'}`)
  return parts.join(' · ')
}
