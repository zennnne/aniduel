import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createCatchUpVisit, type CatchUpVisitDeps } from '../../catchup/visit.ts'
import type { WriteQueue } from '../../writes/writeQueue.ts'

/** The module, reading what it needs from the app as of the latest `provide`. */
function create(deps: CatchUpVisitDeps) {
  let latest = deps
  return { visit: createCatchUpVisit(() => latest), provide: (next: CatchUpVisitDeps) => void (latest = next) }
}

/**
 * Catch-up (#49, #57) at App level: one module for as long as the app is open, its state on every change, what it
 * needs from the app as of the latest render, and the user's write queue for as long as there is one.
 */
export function useCatchUp({ queue, ...deps }: CatchUpVisitDeps & { queue: WriteQueue | null }) {
  const [{ visit, provide }] = useState(() => create(deps))
  useLayoutEffect(() => provide(deps))
  useEffect(() => visit.attach(queue), [visit, queue])
  const snapshot = useSyncExternalStore(visit.subscribe, visit.snapshot)
  return { ...visit, ...snapshot }
}
