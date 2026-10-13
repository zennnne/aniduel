// The AniList session (#78), from the login of this page load to logout: the token and what reaches AniList with it,
// the Viewer, and the user's lists per Media Type. It reports what it read and what failed, and knows nothing of
// Rankings: what a Viewer or a list means for the open one is the app's.
import { AniListError, createAniListGateway, type AniListGateway, type AniListSession } from '../anilist/gateway.ts'
import type { ListEntry, MediaType, Viewer } from '../anilist/types.ts'
import { aniListCandidateSource, type CandidateSource } from '../catchup/suggestionCandidates.ts'
import type { Clock } from '../clock.ts'
import { LIST_STATUSES } from '../pool/pool.ts'
import { createRequestLimiter, type RequestLimiter } from '../writes/limiter.ts'
import { logout, restoreSession, type BrowserHistory, type BrowserLocation } from './session.ts'

export type SessionSnapshot = {
  /** The login's token, or null when the user is logged out. */
  token: string | null
  gateway: AniListGateway | null
  /** The write queue's requests and Catch-up's reads take turns in one limiter, so together they keep to AniList's rate limit. */
  limiter: RequestLimiter | null
  /** Reads of anime for Catch-up's suggestion candidates. */
  candidateSource: CandidateSource | null
  viewer: Viewer | null
  /** The user's lists as read so far, in every status (`LIST_STATUSES`). */
  lists: Partial<Record<MediaType, ListEntry[]>>
}

/** Where the session lives: fixed for as long as the app is open. */
export type SessionEnv = {
  storage: Storage
  location: BrowserLocation
  history: BrowserHistory
  /** The browser's `fetch`. */
  fetch: typeof fetch
  clock: Clock
  /** Dev only (#68): a session on a fake AniList in place of the login and the network. */
  fake?: AniListSession
}

/** What the session tells the app around it. Read whenever it is needed, so it is always the latest. */
export type SessionEvents = {
  /** The Viewer arrived, once per login. */
  onViewer: (viewer: Viewer) => void
  /** A list arrived, read for the first time or again. */
  onListRead: (type: MediaType, list: ListEntry[]) => void
  /** AniList no longer takes the login: it expired or was revoked. The app ends the session, with what else has to close. */
  onExpired: () => void
  /** AniList couldn't be reached, or didn't answer as it should. `retry` reads again what is still missing. */
  onUnreachable: () => void
}

export type Session = {
  /** The `fetch` that reaches AniList: the fake session's when there is one. */
  fetch: typeof fetch
  /** False when the browser refused to store a token that just arrived: the login holds until the page is left. */
  saved: boolean
  snapshot(): SessionSnapshot
  /** Called on every change; returns an unsubscribe. */
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void
  /** Starts reading, the Viewer first. The function returned drops what is still being read. */
  start(): () => void
  /**
   * The lists the app needs now, the most needed first. Each one not read yet is read, one at a time; a read still in
   * flight for a list no longer next in line is dropped. Nothing is read before the Viewer is known: the app says
   * what it needs again once it is.
   */
  need(types: readonly MediaType[]): void
  /**
   * Reads a list again (after Catch-up wrote to it), reported like a first read. Resolves once it is read, or
   * couldn't be. A first read still in flight is dropped when this one lands: it may have left before the write.
   */
  refresh(type: MediaType): Promise<void>
  /** The `Viewer` as AniList reports it now, read elsewhere (Preview's check): not a new login. */
  viewerChecked(viewer: Viewer): void
  /** Scores AniList has now for titles an Import wrote, so the list shows them without being read again. */
  scoresWritten(type: MediaType, written: ReadonlyMap<number, number>): void
  /** A request to AniList failed, here or elsewhere: an expired or revoked login, or else AniList unreachable. */
  failed(error: unknown): void
  /** Reads again what a failed read left missing: the Viewer, or the list needed next. */
  retry(): void
  /**
   * Logout, or the login expired: the token is forgotten and nothing still being read arrives. With `deleteProgress`,
   * this user's saved progress in this browser is deleted too, so whatever still saves must have stopped before.
   */
  end(deleteProgress: boolean): void
}

const LOGGED_OUT: SessionSnapshot = { token: null, gateway: null, limiter: null, candidateSource: null, viewer: null, lists: {} }

export function createAniListSession(env: SessionEnv, events: () => SessionEvents): Session {
  const { storage, clock, fake } = env
  const fetch = fake?.fetch ?? env.fetch
  // A token that just arrived may not have been saved: it holds until the page is left.
  const login = fake ? { token: fake.token, saved: true } : restoreSession({ location: env.location, history: env.history, storage })

  let state = login.token ? loggedIn(login.token) : LOGGED_OUT
  const listeners = new Set<(snapshot: SessionSnapshot) => void>()
  let needed: readonly MediaType[] = []
  // The reads in flight. One that is no longer the one held here is dropped when it lands.
  let viewerRead: object | null = null
  let listRead: { type: MediaType } | null = null

  function loggedIn(token: string): SessionSnapshot {
    const limiter = createRequestLimiter(clock)
    return {
      ...LOGGED_OUT,
      token,
      gateway: createAniListGateway({ fetch, token }),
      limiter,
      candidateSource: aniListCandidateSource({ fetch, token, clock, limiter }),
    }
  }

  function set(next: SessionSnapshot) {
    state = next
    for (const listener of listeners) listener(state)
  }

  function failed(error: unknown) {
    if (error instanceof AniListError && error.kind === 'auth') events().onExpired()
    else events().onUnreachable()
  }

  function readViewer() {
    const { gateway } = state
    if (!gateway || state.viewer) return
    const read = (viewerRead = {})
    const landed = () => {
      if (viewerRead !== read) return false
      viewerRead = null
      return true
    }
    gateway.viewer().then(
      (viewer) => {
        if (!landed()) return
        set({ ...state, viewer })
        events().onViewer(viewer)
      },
      (e: unknown) => landed() && failed(e),
    )
  }

  function listLanded(type: MediaType, list: ListEntry[]) {
    set({ ...state, lists: { ...state.lists, [type]: list } })
    events().onListRead(type, list)
    readNeeded()
  }

  /** Reads the first list needed that hasn't been read; `again` starts over a read already in flight. */
  function readNeeded(again = false) {
    const { gateway, viewer } = state
    if (!gateway || !viewer) return
    const type = needed.find((t) => !state.lists[t])
    if (!type) {
      listRead = null
      return
    }
    if (listRead?.type === type && !again) return
    const read = (listRead = { type })
    const landed = () => {
      if (listRead !== read) return false
      listRead = null
      return true
    }
    // Every status at once, so each chip can show its count and toggling needs no refetch. Planning comes too,
    // for Keep My Scale's Anchors and Pool (LIST_STATUSES); nothing shows or offers those titles.
    gateway.mediaList({ userId: viewer.id, type, statuses: LIST_STATUSES }).then(
      (list) => landed() && listLanded(type, list),
      (e: unknown) => landed() && failed(e),
    )
  }

  return {
    fetch,
    saved: login.saved,
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    start() {
      readViewer()
      return () => {
        viewerRead = null
        listRead = null
      }
    },
    need(types) {
      needed = types
      readNeeded()
    },
    refresh(type) {
      const { gateway, viewer } = state
      if (!gateway || !viewer) return Promise.resolve()
      return gateway.mediaList({ userId: viewer.id, type, statuses: LIST_STATUSES }).then(
        (list) => {
          if (state.gateway !== gateway) return
          if (listRead?.type === type) listRead = null
          listLanded(type, list)
        },
        () => {}, // the next list read catches up
      )
    },
    viewerChecked(viewer) {
      if (state.gateway) set({ ...state, viewer })
    },
    scoresWritten(type, written) {
      const current = state.lists[type]
      if (!current) return
      const list = current.map((e) => (written.has(e.mediaId) ? { ...e, oldScore100: written.get(e.mediaId)! } : e))
      set({ ...state, lists: { ...state.lists, [type]: list } })
    },
    failed,
    retry() {
      readViewer()
      readNeeded(true)
    },
    end(deleteProgress) {
      // The fake session has no token of its own: the one in storage is the real login's, and stays.
      if (!fake) logout(storage, { userId: state.viewer?.id ?? null, deleteProgress })
      viewerRead = null
      listRead = null
      set(LOGGED_OUT)
    },
  }
}
