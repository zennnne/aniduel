// Watched: every list status except Planning, however the user scored it (#37 stories 21–22).
import type { ListStatus } from '../anilist/types.ts'

export function isWatched(entry: { status: ListStatus }): boolean {
  return entry.status !== 'PLANNING'
}
