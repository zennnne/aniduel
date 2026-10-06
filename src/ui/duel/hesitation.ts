import { useEffect, useState } from 'react'

/** How long one Duel can stay unanswered, in visible time, before the Same button nudges. */
export const HESITATION_MS = 20_000

type VisibilitySource = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/**
 * Calls `onHesitate` once `ms` of visible time has passed: the clock stops while the tab is hidden
 * (e.g. the user is reading the title on AniList) and goes on when it is back. Returns the cleanup.
 */
export function watchHesitation(doc: VisibilitySource, ms: number, onHesitate: () => void): () => void {
  let left = ms
  let startedAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = () => {
    if (timer !== undefined || left <= 0) return
    startedAt = Date.now()
    timer = setTimeout(() => {
      timer = undefined
      left = 0
      onHesitate()
    }, left)
  }
  const stop = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    left -= Date.now() - startedAt
  }
  const onVisibility = () => (doc.visibilityState === 'hidden' ? stop() : start())
  doc.addEventListener('visibilitychange', onVisibility)
  onVisibility()
  return () => {
    stop()
    doc.removeEventListener('visibilitychange', onVisibility)
  }
}

/** True once the Duel shown for `pairKey` has gone unanswered for HESITATION_MS of visible time. */
export function useHesitation(pairKey: unknown): boolean {
  const [hesitatedOn, setHesitatedOn] = useState<unknown>(undefined)
  useEffect(() => watchHesitation(document, HESITATION_MS, () => setHesitatedOn(() => pairKey)), [pairKey])
  return hesitatedOn !== undefined && hesitatedOn === pairKey
}
