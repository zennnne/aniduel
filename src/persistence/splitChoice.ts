// The remembered split choice (#71, ADR 0013): "Ask me" or "More Duels first", as the user last chose it in the
// Picker themselves, so the next Picker opens on it. Kept per user in this browser's storage, for Anime and Manga
// alike, under the user's progress so logout deletes it; never in a Backup.
import type { NamedSplitRule } from '../ranking/engine.ts'
import { userStorageKey } from './progress.ts'

const PART = 'keep-my-scale-split'

const RULES: readonly NamedSplitRule[] = ['on-the-score', 'deciding-duels']

export type SplitChoiceStore = ReturnType<typeof createSplitChoiceStore>

export function createSplitChoiceStore(storage: Storage, userId: number) {
  const key = userStorageKey(userId, PART)
  return {
    /** The choice the user last made themselves; null if none, or if what is stored is not one of the two. */
    choice(): NamedSplitRule | null {
      const value = storage.getItem(key)
      return RULES.find((rule) => rule === value) ?? null
    },
    /**
     * Remembers a choice the user made by touching the control. If the browser refuses, nothing is remembered: the
     * Ranking it was chosen for has started all the same, and only the next Picker's selection is lost.
     */
    remember(rule: NamedSplitRule) {
      try {
        storage.setItem(key, rule)
      } catch {
        // Nothing to undo: the last remembered choice, if any, is still there.
      }
    },
  }
}
