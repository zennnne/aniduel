import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createDuelLogStore } from '../persistence/duelLogStore.ts'
import { createRankingLifecycle, type RankingLifecycleDeps } from '../persistence/rankingLifecycle.ts'

/** What the Ranking's lifecycle needs from the app around it. */
type LifecycleDeps = Pick<RankingLifecycleDeps, 'seed' | 'discardImport'>

/** The store and the lifecycle over it; the lifecycle reads what it needs from the app as of the latest `provide`. */
function create(storage: Storage, deps: LifecycleDeps) {
  let latest = deps
  const store = createDuelLogStore(storage)
  const lifecycle = createRankingLifecycle({
    storage,
    duelLog: store,
    seed: () => latest.seed(),
    discardImport: (key) => latest.discardImport(key),
  })
  return { store, lifecycle, provide: (next: LifecycleDeps) => void (latest = next) }
}

/**
 * The Duel log of the open Ranking at App level: one store for as long as the app is open, and the log on screen with
 * its replay on every change (both null when this Media Type has no usable Ranking). Answers are appended through
 * `append`; a Ranking is opened, started, replaced, ended and thrown away through `lifecycle` only, so the store's
 * `show`, `save` and `close` are not handed out.
 */
export function useDuelLog(storage: Storage, deps: LifecycleDeps) {
  const [{ store, lifecycle, provide }] = useState(() => create(storage, deps))
  useLayoutEffect(() => provide(deps))
  const shown = useSyncExternalStore(store.subscribe, store.latest)
  return { latest: store.latest, append: store.append, lifecycle, log: shown?.log ?? null, ranking: shown?.ranking ?? null }
}
