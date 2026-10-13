import { useState, useSyncExternalStore } from 'react'
import { createDuelLogStore } from '../persistence/duelLogStore.ts'

/**
 * The Duel log of the open Ranking at App level: one store for as long as the app is open, and the log on screen with
 * its replay on every change (both null when this Media Type has no usable Ranking).
 */
export function useDuelLog(storage: Storage) {
  const [store] = useState(() => createDuelLogStore(storage))
  const shown = useSyncExternalStore(store.subscribe, store.latest)
  return { ...store, log: shown?.log ?? null, ranking: shown?.ranking ?? null }
}
