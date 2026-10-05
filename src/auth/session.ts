// AniList OAuth implicit grant (ADR 0004: no router; the token arrives in the URL fragment).
import { deleteSavedProgress } from '../persistence/progress.ts'

const TOKEN_KEY = 'aniduel/token'

export function authorizeUrl(clientId: number): string {
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`
}

export type BrowserLocation = { pathname: string; search: string; hash: string }
export type BrowserHistory = Pick<History, 'replaceState'>

/**
 * Call once on load. If AniList just redirected back with `#access_token=…`, stores the token
 * and clears the fragment with `history.replaceState`. Returns the stored token, or null.
 */
export function restoreSession(deps: {
  location: BrowserLocation
  history: BrowserHistory
  storage: Storage
}): string | null {
  const { location, history, storage } = deps
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  if (fragment.has('access_token') || fragment.has('error')) {
    const token = fragment.get('access_token')
    if (token) storage.setItem(TOKEN_KEY, token)
    history.replaceState(null, '', location.pathname + location.search)
  }
  return storage.getItem(TOKEN_KEY)
}

/** Clears the token. With `deleteProgress`, also deletes this user's saved progress in this browser. */
export function logout(storage: Storage, options: { userId: number | null; deleteProgress: boolean }): void {
  storage.removeItem(TOKEN_KEY)
  if (options.deleteProgress && options.userId !== null) deleteSavedProgress(storage, options.userId)
}
