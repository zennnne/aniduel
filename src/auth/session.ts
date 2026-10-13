// AniList OAuth implicit grant (ADR 0004: no router; the token arrives in the URL fragment).
import { deleteSavedProgress } from '../persistence/progress.ts'

const TOKEN_KEY = 'aniduel/token'

export function authorizeUrl(clientId: number): string {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`
}

export type BrowserLocation = { pathname: string; search: string; hash: string }
export type BrowserHistory = Pick<History, 'replaceState'>

/**
 * The login of this page load: the token, or null when the user is logged out. `saved` is false when the browser
 * refused to store a token that just arrived (its storage is full or blocked): the login holds until the page is left.
 */
export type RestoredSession = { token: string | null; saved: boolean }

/**
 * Call once on load. If AniList just redirected back with `#access_token=…`, stores the token
 * and clears the fragment with `history.replaceState`. Returns the token that arrived, or else the stored one.
 */
export function restoreSession(deps: {
  location: BrowserLocation
  history: BrowserHistory
  storage: Storage
}): RestoredSession {
  const { location, history, storage } = deps
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  let arrived: string | null = null
  let saved = true
  if (fragment.has('access_token') || fragment.has('error')) {
    arrived = fragment.get('access_token') || null
    if (arrived) {
      try {
        storage.setItem(TOKEN_KEY, arrived)
      } catch {
        saved = false
      }
    }
    history.replaceState(null, '', location.pathname + location.search)
  }
  return { token: arrived ?? storage.getItem(TOKEN_KEY), saved }
}

/** Clears the token. With `deleteProgress`, also deletes this user's saved progress in this browser. */
export function logout(storage: Storage, options: { userId: number | null; deleteProgress: boolean }): void {
  storage.removeItem(TOKEN_KEY)
  if (options.deleteProgress && options.userId !== null) deleteSavedProgress(storage, options.userId)
}
