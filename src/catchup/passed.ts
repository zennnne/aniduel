// Catch-up's Passed history (#50): titles left unmarked when a batch was saved, with when. Kept per user in this
// browser's storage, under the user's anime progress, so logout deletes it with the rest.
import { animeProgressKey, loadProgressPart, progressStorageKey, saveProgressPart } from '../persistence/progress.ts'
import { PASSED_HIDE_MS } from './suggest.ts'

const key = (userId: number) => animeProgressKey(userId, 'catchup-passed')

const hidden = (at: number, now: number) => now - at < PASSED_HIDE_MS

/** One user's Passed history: media id → when it was last Passed. A title comes back after 30 days; none hide for good. */
export function createPassedStore(storage: Storage, userId: number) {
  function history(): Map<number, number> {
    const raw = loadProgressPart(storage, key(userId))
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
      saveProgressPart(storage, key(userId), JSON.stringify([...next]))
    },
    /** Empties the history: every title may be suggested again from the next batch. */
    clear() {
      storage.removeItem(progressStorageKey(key(userId)))
    },
    /** How many titles are hidden from suggestions at `now`. */
    hiddenCount(now: number): number {
      return [...history().values()].filter((at) => hidden(at, now)).length
    },
  }
}
