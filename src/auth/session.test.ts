import { describe, expect, it } from 'vitest'
import { authorizeUrl, logout, restoreSession } from './session.ts'
import { saveProgressPart } from '../persistence/progress.ts'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  }
}

function fakeBrowser(href: string) {
  const replaced: string[] = []
  return {
    location: new URL(href),
    history: { replaceState: (_data: unknown, _unused: string, url?: string | URL | null) => void replaced.push(String(url)) },
    replaced,
  }
}

describe('authorizeUrl', () => {
  it('sends the user to the AniList implicit grant for the given client', () => {
    expect(authorizeUrl(52824)).toBe(
      'https://anilist.co/api/v2/oauth/authorize?client_id=52824&response_type=token',
    )
  })
})

describe('restoreSession', () => {
  it('reads the token from the URL fragment after the AniList redirect, stores it and clears the fragment', () => {
    const storage = memoryStorage()
    const browser = fakeBrowser(
      'http://localhost:5173/aniduel/#access_token=abc.def&token_type=Bearer&expires_in=31536000',
    )

    const token = restoreSession({ ...browser, storage })

    expect(token).toBe('abc.def')
    expect(browser.replaced).toEqual(['/aniduel/'])
    // A later load without the fragment still finds the token.
    expect(restoreSession({ ...fakeBrowser('http://localhost:5173/aniduel/'), storage })).toBe('abc.def')
  })

  it('keeps the query string when clearing the fragment', () => {
    const browser = fakeBrowser('https://zennnne.github.io/aniduel/?x=1#access_token=t1&token_type=Bearer')

    restoreSession({ ...browser, storage: memoryStorage() })

    expect(browser.replaced).toEqual(['/aniduel/?x=1'])
  })

  it('returns no token and leaves the URL alone when the user has never logged in', () => {
    const browser = fakeBrowser('https://zennnne.github.io/aniduel/')

    expect(restoreSession({ ...browser, storage: memoryStorage() })).toBeNull()
    expect(browser.replaced).toEqual([])
  })

  it('clears an error fragment (e.g. the user denied access) without storing anything', () => {
    const storage = memoryStorage()
    const browser = fakeBrowser('https://zennnne.github.io/aniduel/#error=access_denied')

    expect(restoreSession({ ...browser, storage })).toBeNull()
    expect(browser.replaced).toEqual(['/aniduel/'])
  })
})

describe('logout', () => {
  function loggedInWithProgress() {
    const storage = memoryStorage()
    restoreSession({ ...fakeBrowser('https://x/aniduel/#access_token=tok'), storage })
    saveProgressPart(storage, { userId: 42, mediaType: 'ANIME', part: 'log' }, '[1,2,3]')
    saveProgressPart(storage, { userId: 42, mediaType: 'MANGA', part: 'log' }, '[4]')
    saveProgressPart(storage, { userId: 7, mediaType: 'ANIME', part: 'log' }, '[5]')
    storage.setItem('unrelated', 'keep')
    return storage
  }
  const noFragment = () => fakeBrowser('https://x/aniduel/')

  it('clears the token but keeps saved progress by default', () => {
    const storage = loggedInWithProgress()

    logout(storage, { userId: 42, deleteProgress: false })

    expect(restoreSession({ ...noFragment(), storage })).toBeNull()
    expect(storage.length).toBe(4)
  })

  it("also deletes this user's saved progress, and only theirs, when asked", () => {
    const storage = loggedInWithProgress()

    logout(storage, { userId: 42, deleteProgress: true })

    expect(restoreSession({ ...noFragment(), storage })).toBeNull()
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
    expect(keys).toHaveLength(2)
    expect(storage.getItem('unrelated')).toBe('keep')
    expect(keys.some((k) => k?.includes('42'))).toBe(false)
  })
})
