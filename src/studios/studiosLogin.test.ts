// The AniDuel! login as Top Studios sees it: the stored token, and the user's own name from the Viewer query.
import { describe, expect, it } from 'vitest'
import { checkLogin } from './studiosLogin.ts'

function fakeFetch(...responses: Array<{ status?: number; json: unknown } | 'offline'>) {
  const calls: RequestInit[] = []
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init ?? {})
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    if (next === 'offline') throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

const viewer = {
  json: {
    data: {
      Viewer: { id: 7, name: 'zen', avatar: { medium: null }, options: { titleLanguage: 'ROMAJI' }, mediaListOptions: { scoreFormat: 'POINT_10' } },
    },
  },
}

describe('the AniDuel! login on Top Studios', () => {
  it('is logged out with no stored token, and asks AniList nothing', async () => {
    const { fetch, calls } = fakeFetch()
    expect(await checkLogin({ fetch, token: null })).toEqual({ own: { kind: 'none' }, token: null })
    expect(calls).toHaveLength(0)
  })

  it('knows the user’s own name from the stored token, and keeps the token for the lookups', async () => {
    const { fetch, calls } = fakeFetch(viewer)
    expect(await checkLogin({ fetch, token: 'tok' })).toEqual({ own: { kind: 'known', name: 'zen' }, token: 'tok' })
    expect(new Headers(calls[0].headers).get('Authorization')).toBe('Bearer tok')
  })

  it('carries on without a token AniList refuses', async () => {
    const { fetch } = fakeFetch({ status: 401, json: { data: null, errors: [{ message: 'Unauthorized.', status: 401 }] } })
    expect(await checkLogin({ fetch, token: 'old' })).toEqual({ own: { kind: 'none' }, token: null })
  })

  it('keeps the token but knows no name when AniList can’t be reached', async () => {
    const { fetch } = fakeFetch('offline')
    expect(await checkLogin({ fetch, token: 'tok' })).toEqual({ own: { kind: 'none' }, token: 'tok' })
  })
})
