// Remembered unsettled titles (#66, ADR 0011): when an Import ends a Keep My Scale Ranking, the picked titles that
// were neither Settled nor Forgotten, so the next Picker can offer them again. Title ids only, no answers. Kept per
// user and Media Type in this browser's storage, under the user's progress so logout deletes it; never in a Backup.
import type { ListEntry } from '../anilist/types.ts'
import type { RankingState } from '../ranking/engine.ts'
import { loadProgressPart, progressStorageKey, saveProgressPart, type ProgressKey, type RankingKey } from './progress.ts'

const PART = 'keep-my-scale-unsettled'

export type UnsettledStore = ReturnType<typeof createUnsettledStore>

export function createUnsettledStore(storage: Storage, ranking: RankingKey) {
  const key: ProgressKey = { ...ranking, part: PART }

  function stored(): number[] {
    const raw = loadProgressPart(storage, key)
    if (raw === null) return []
    try {
      const ids = JSON.parse(raw) as unknown
      return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
    } catch {
      return []
    }
  }

  function clear() {
    storage.removeItem(progressStorageKey(key))
  }

  return {
    /**
     * Remembers the titles a Keep My Scale Ranking leaves unsettled as its Import ends it (Forgotten ones are not in
     * its titles); with none, clears the list. Returns how many it remembered. Throws SaveError if the
     * browser refuses.
     */
    remember(ended: RankingState): number {
      const ids = (ended.keepMyScale?.titles ?? []).filter((t) => !t.settled).map((t) => t.id)
      if (ids.length === 0) clear()
      else saveProgressPart(storage, key, JSON.stringify(ids))
      return ids.length
    },
    /** The remembered titles the Picker can still show: on the list and not Planning. */
    titles(list: readonly ListEntry[]): number[] {
      const shown = new Set(list.filter((e) => e.status !== 'PLANNING').map((e) => e.mediaId))
      return stored().filter((id) => shown.has(id))
    },
    /** Forgets the list: the next Keep My Scale Ranking starts, whichever answer was given. */
    clear,
  }
}
