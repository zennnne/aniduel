import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createPreviewImport, type PreviewImportDeps } from '../../import/previewImport.ts'

/** The module, reading what it needs from the app as of the latest `provide`. */
function create(deps: PreviewImportDeps) {
  let latest = deps
  return { previewImport: createPreviewImport(() => latest), provide: (next: PreviewImportDeps) => void (latest = next) }
}

/**
 * Preview and Import (#56) at App level: one module for as long as the app is open, its state on every change, and
 * what it needs from the app as of the latest render.
 */
export function usePreviewImport(deps: PreviewImportDeps) {
  const [{ previewImport, provide }] = useState(() => create(deps))
  useLayoutEffect(() => provide(deps))
  const snapshot = useSyncExternalStore(previewImport.subscribe, previewImport.snapshot)
  return { ...previewImport, ...snapshot }
}
