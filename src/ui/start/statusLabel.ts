import type { ListStatus, MediaType } from '../../anilist/types.ts'

const STATUS_LABEL: Record<ListStatus, string> = {
  COMPLETED: 'Completed',
  REPEATING: 'Repeating',
  CURRENT: 'Watching',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
  PLANNING: 'Planning',
}
const MANGA_LABEL: Partial<Record<ListStatus, string>> = { CURRENT: 'Reading' }

/** A list status as AniList shows it for this Media Type ("Watching" vs "Reading"). */
export function statusLabel(status: ListStatus, mediaType: MediaType): string {
  return (mediaType === 'MANGA' && MANGA_LABEL[status]) || STATUS_LABEL[status]
}
