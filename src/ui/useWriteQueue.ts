import { useEffect, useEffectEvent, useState } from 'react'
import type { AniListGateway } from '../anilist/gateway.ts'
import { browserClock } from '../clock.ts'
import { loadWriteQueue, saveWriteQueue } from '../persistence/progress.ts'
import type { RequestLimiter } from '../writes/limiter.ts'
import { createWriteQueue, type WriteQueue, type WriteQueueSnapshot } from '../writes/writeQueue.ts'

/**
 * The logged-in user's write queue (Import's scores and Catch-up's statuses), at App level so it keeps writing whichever
 * screen shows. It resumes what a reload left unwritten straight away; a saved Import waits to be resumed.
 */
export function useWriteQueue(deps: {
  storage: Storage
  gateway: AniListGateway | null
  userId: number | null
  limiter: RequestLimiter | null
  onError: (error: unknown) => void
}) {
  const [current, setCurrent] = useState<{ queue: WriteQueue; snapshot: WriteQueueSnapshot } | null>(null)
  const onError = useEffectEvent((error: unknown) => deps.onError(error))
  const { storage, gateway, userId, limiter } = deps

  useEffect(() => {
    if (!gateway || userId === null || !limiter) return
    const queue = createWriteQueue({
      gateway,
      clock: browserClock,
      limiter,
      userId,
      initial: loadWriteQueue(storage, userId),
      save: (state) => saveWriteQueue(storage, userId, state),
      onError: (e) => onError(e),
    })
    const unsubscribe = queue.subscribe((snapshot) => setCurrent({ queue, snapshot }))
    queue.resume() // also reports what was saved, e.g. failures waiting for Retry
    return () => {
      unsubscribe()
      queue.stop()
      setCurrent((c) => (c?.queue === queue ? null : c))
    }
  }, [gateway, userId, limiter, storage])

  return {
    queue: current?.queue ?? null,
    snapshot: current?.snapshot ?? null,
    /** Logout: the queue stops and lets go of what it saved, before the user's progress is deleted. */
    stop: () => current?.queue.stop(),
  }
}
