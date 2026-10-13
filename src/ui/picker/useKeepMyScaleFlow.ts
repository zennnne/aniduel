import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createKeepMyScaleFlow, type KeepMyScaleFlowDeps } from './keepMyScaleFlow.ts'

/** The module, reading what it needs from the app as of the latest `provide`. */
function create(deps: KeepMyScaleFlowDeps) {
  let latest = deps
  return { flow: createKeepMyScaleFlow(() => latest), provide: (next: KeepMyScaleFlowDeps) => void (latest = next) }
}

/**
 * The way into a Keep My Scale Ranking (#80) at App level: one module for as long as the app is open, its state on
 * every change, and what it needs from the app as of the latest render.
 */
export function useKeepMyScaleFlow(deps: KeepMyScaleFlowDeps) {
  const [{ flow, provide }] = useState(() => create(deps))
  useLayoutEffect(() => provide(deps))
  const snapshot = useSyncExternalStore(flow.subscribe, flow.snapshot)
  return { ...flow, ...snapshot }
}
