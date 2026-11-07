// The AniLyze hub's view (#102, look from #99): what the username field holds, the line under it, and each card.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hubView, type HubViewInput } from './hubView.ts'

const view = (input: Partial<HubViewInput>) => hubView({ own: { kind: 'none' }, typed: null, ...input })
const zen = { kind: 'known', name: 'Zen' } as const

beforeEach(() => {
  vi.stubGlobal('window', { location: { search: '' } })
  vi.stubEnv('DEV', false)
  vi.stubEnv('BASE_URL', '/aniduel/')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the username field', () => {
  it('holds the logged-in user’s own name', () => {
    expect(view({ own: zen }).field).toBe('Zen')
  })

  it('is empty when logged out', () => {
    expect(view({ own: { kind: 'none' } }).field).toBe('')
  })

  it('is empty while the login is still being checked', () => {
    expect(view({ own: { kind: 'checking' } }).field).toBe('')
  })

  it('keeps what the visitor typed, even once the login lands', () => {
    expect(view({ own: { kind: 'checking' }, typed: 'Friend' }).field).toBe('Friend')
    expect(view({ own: zen, typed: 'Friend' }).field).toBe('Friend')
    expect(view({ own: zen, typed: '' }).field).toBe('')
  })
})

describe('the line under the field', () => {
  it('says the name will fill in while the login is checked, or that the typed one is kept', () => {
    expect(view({ own: { kind: 'checking' } }).login).toEqual({ kind: 'checking', keepingTyped: false })
    expect(view({ own: { kind: 'checking' }, typed: 'F' }).login).toEqual({ kind: 'checking', keepingTyped: true })
  })

  it('names the logged-in user, and offers to look up someone else while the field holds their own name', () => {
    expect(view({ own: zen }).login).toEqual({ kind: 'logged-in', name: 'Zen', ownNameInField: true })
    expect(view({ own: zen, typed: 'zen ' }).login).toEqual({ kind: 'logged-in', name: 'Zen', ownNameInField: true })
    expect(view({ own: zen, typed: 'Friend' }).login).toEqual({ kind: 'logged-in', name: 'Zen', ownNameInField: false })
  })

  it('says anyone can be looked up when logged out', () => {
    expect(view({}).login).toEqual({ kind: 'logged-out' })
  })
})

describe('the cards', () => {
  it('are only the tools that exist: Top Studios and Top Directors', () => {
    expect(view({}).cards.map((card) => card.name)).toEqual(['Top Studios', 'Top Directors'])
  })

  it('open Top Directors with the name in the field too, or blank', () => {
    expect(view({ typed: 'Fake Zen' }).cards[1]).toMatchObject({
      tool: 'directors',
      icon: '🎬',
      noun: 'directors',
      blurb: 'Same rules as Top Studios, for the people who directed them.',
      who: 'does Fake Zen',
      button: 'Show Fake Zen’s top directors →',
      href: '/aniduel/anilyze/directors/?user=Fake%20Zen',
    })
    expect(view({}).cards[1]).toMatchObject({ button: 'Open Top Directors →', href: '/aniduel/anilyze/directors/' })
  })

  it('open the tool with the name in the field, so the result loads at once', () => {
    expect(view({ own: zen }).cards[0].href).toBe('/aniduel/anilyze/studios/?user=Zen')
    expect(view({ typed: ' Fake Zen ' }).cards[0].href).toBe('/aniduel/anilyze/studios/?user=Fake%20Zen')
  })

  it('open the tool blank when the field is empty', () => {
    expect(view({}).cards[0].href).toBe('/aniduel/anilyze/studios/')
    expect(view({ own: zen, typed: '  ' }).cards[0].href).toBe('/aniduel/anilyze/studios/')
  })

  it('keep the fake AniList switch under npm run dev', () => {
    vi.stubGlobal('window', { location: { search: '?fake-anilist' } })
    vi.stubEnv('DEV', true)
    expect(view({ typed: 'Fake Zen' }).cards[0].href).toBe('/aniduel/anilyze/studios/?fake-anilist&user=Fake%20Zen')
  })

  it('ask about the user’s own list in the second person', () => {
    expect(view({ own: zen }).cards[0]).toMatchObject({ who: 'do you', button: 'Show my top studios →' })
  })

  it('ask about anyone else by name', () => {
    expect(view({ own: zen, typed: 'Friend' }).cards[0]).toMatchObject({ who: 'does Friend', button: 'Show Friend’s top studios →' })
  })

  it('ask about "this fan" and just open the tool when the field is empty', () => {
    expect(view({}).cards[0]).toMatchObject({ who: 'does this fan', button: 'Open Top Studios →' })
  })

  it('say what the tool ranks from', () => {
    expect(view({}).cards[0]).toMatchObject({
      tool: 'studios',
      icon: '🏢',
      noun: 'studios',
      blurb: 'Ranked from scores, drops, rewatches and favourites.',
    })
  })
})
