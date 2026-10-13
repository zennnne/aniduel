import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { AniListSession } from '../anilist/gateway.ts'
import type { MediaType } from '../anilist/types.ts'
import { createAniListSession, type SessionEnv, type SessionEvents } from '../auth/aniListSession.ts'
import { browserClock } from '../clock.ts'

const browserFetch: typeof fetch = (...args) => window.fetch(...args)

/** The module, telling the app what happened as of the latest `provide`. */
function create(env: SessionEnv, events: SessionEvents) {
  let latest = events
  return { session: createAniListSession(env, () => latest), provide: (next: SessionEvents) => void (latest = next) }
}

/**
 * The AniList session (#78) at App level: one module for as long as the app is open, its state on every change, and
 * what it tells the app as of the latest render. It reads the Viewer once there is a login, then the lists the app
 * needs: the selected Media Type's, and with `animeToo` the anime list as well.
 */
export function useAniListSession({
  storage,
  fake,
  mediaType,
  animeToo,
  ...events
}: SessionEvents & { storage: Storage; fake?: AniListSession; mediaType: MediaType; animeToo: boolean }) {
  const [{ session, provide }] = useState(() =>
    create({ storage, location: window.location, history: window.history, fetch: browserFetch, clock: browserClock, fake }, events),
  )
  useLayoutEffect(() => provide(events))
  useEffect(() => session.start(), [session])
  const snapshot = useSyncExternalStore(session.subscribe, session.snapshot)
  const { viewer } = snapshot
  // Said again once the Viewer is known: the Media Type to open is only chosen then.
  useEffect(() => session.need(animeToo ? [mediaType, 'ANIME'] : [mediaType]), [session, viewer, mediaType, animeToo])
  return { ...session, ...snapshot }
}
