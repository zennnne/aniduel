// Catch-up's Passed history (#50): titles left unmarked when a batch was saved, with when. Kept per user and Media
// Type in this browser's storage, under that Media Type's progress, so logout deletes it with the rest.
import type { MediaType } from '../anilist/types.ts'
import { loadProgressPart, progressStorageKey, saveProgressPart, type ProgressKey } from '../persistence/progress.ts'
import { PASSED_HIDE_MS } from './suggest.ts'

const key = (userId: number, mediaType: MediaType): ProgressKey => ({ userId, mediaType, part: 'catchup-passed' })

const hidden = (at: number, now: number) => now - at < PASSED_HIDE_MS

/**
 * One user's Passed history for one Media Type: media id → when it was last Passed. A title comes back after 30 days;
 * none hide for good.
 */
export function createPassedStore(storage: Storage, userId: number, mediaType: MediaType) {
  function history(): Map<number, number> {
    const raw = loadProgressPart(storage, key(userId, mediaType))
    if (raw === null) return new Map()
    try {
      const entries = JSON.parse(raw) as unknown
      if (!Array.isArray(entries)) return new Map()
      return new Map(
        entries.filter(
          (e): e is [number, number] => Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number',
        ),
      )
    } catch {
      return new Map()
    }
  }

  return {
    history,
    /** Records the titles left unmarked in a saved batch; titles past their 30 days are dropped on the way. */
    record(ids: readonly number[], at: number) {
      const next = new Map([...history()].filter(([, passedAt]) => hidden(passedAt, at)))
      for (const id of ids) next.set(id, at)
      saveProgressPart(storage, key(userId, mediaType), JSON.stringify([...next]))
    },
    /** Empties the history: every title may be suggested again from the next batch. */
    clear() {
      storage.removeItem(progressStorageKey(key(userId, mediaType)))
    },
    /** How many titles are hidden from suggestions at `now`. */
    hiddenCount(now: number): number {
      return [...history().values()].filter((at) => hidden(at, now)).length
    },
  }
}
