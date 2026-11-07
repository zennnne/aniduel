// An AniLyze tool page in the layout picked in #89 for Top Studios (#92): a big search before a result (errors right
// under the field), then the result under a header with the search. Who is looked up and what the page says is decided
// by the tool's view (#91); the wording and each card's picture are the tool's.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { sitePage } from '../../sitePages.ts'
import type { ToolLoad } from '../load.ts'
import { checkLogin, type OwnName } from '../login.ts'
import { capital, type Tool } from '../tool.ts'
import type { ToolSession } from '../types.ts'
import { Mochi } from './Bits.tsx'
import { HowSureCard } from './HowSureCard.tsx'
import type { Picture } from './Picture.tsx'
import { RankingResult } from './RankingResult.tsx'
import type { CardPicture } from './resultView.ts'
import { searchFor, type LoadState, type ToolView, type ToolViewInput } from './toolView.ts'

/** The load a page with this query starts on: the view's `loadNow` already loading, else nothing yet. */
function landingOn<Loaded>(view: (input: ToolViewInput<Loaded>) => ToolView, search: string): LoadState<Loaded> {
  const { loadNow } = view({ search, own: { kind: 'none' }, load: { kind: 'idle' } })
  return loadNow ? { kind: 'loading', userName: loadNow } : { kind: 'idle' }
}

type Props<Result extends { ok: true }> = {
  session: ToolSession
  tool: Tool
  /** Reads and ranks a user's list (`loadTopStudios`, …). */
  load: (session: ToolSession, userName: string) => Promise<ToolLoad<Result>>
  /** The tool's view over its load (`studiosView`, …). */
  view: (input: ToolViewInput<ToolLoad<Result>>) => ToolView
  /** Draws each card's picture. */
  Picture: Picture
  /** The cards' picture data, as the view made them (the cover of the title that lifts it most by default). */
  cardPicture?: CardPicture
}

export function ToolPage<Result extends { ok: true }>({ session, tool, load: loadList, view: toolView, Picture, cardPicture }: Props<Result>) {
  const { words } = tool
  const [search, setSearch] = useState(() => window.location.search)
  const [own, setOwn] = useState<OwnName>(() => (session.token ? { kind: 'checking' } : { kind: 'none' }))
  // A shared `?user=` link starts loading straight away.
  const [load, setLoad] = useState<LoadState<ToolLoad<Result>>>(() => landingOn(toolView, window.location.search))
  // What the user typed; null until they type, so the field shows the view's name (a shared one, or their own).
  const [typed, setTyped] = useState<string | null>(null)
  // The token lookups send: the stored one, dropped once AniList refuses it.
  const token = useRef(session.token)

  // Memoised: the result's map packs its bubbles from the cards, which should only change with the lookup.
  const view = useMemo(() => toolView({ search, own, load }), [toolView, search, own, load])

  // Each lookup reads fresh from AniList; one that is no longer the latest is dropped when it lands.
  useEffect(() => {
    if (load.kind !== 'loading') return
    const { userName } = load
    let live = true
    loadList({ fetch: session.fetch, token: token.current }, userName)
      .catch((error: unknown): ToolLoad<Result> => ({ ok: false, failure: { kind: 'api', message: String(error) } }))
      .then((loaded) => live && setLoad({ kind: 'loaded', userName, loaded }))
    return () => void (live = false)
  }, [load, loadList, session])

  useEffect(() => {
    let live = true
    checkLogin(session).then((login) => {
      if (!live) return
      token.current = login.token
      setOwn(login.own)
    })
    return () => void (live = false)
  }, [session])

  // Back or Forward lands on another lookup: it loads like a shared link.
  useEffect(() => {
    const onPop = () => {
      setSearch(window.location.search)
      setTyped(null)
      setLoad(landingOn(toolView, window.location.search))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [toolView])

  const name = typed ?? view.formName

  function lookUp(userName: string) {
    // The URL carries the name, so the result can be shared as a link.
    const next = searchFor(window.location.search, userName)
    if (next !== window.location.search) window.history.pushState(null, '', next)
    setSearch(next)
    setTyped(null)
    setLoad({ kind: 'loading', userName })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const userName = name.trim()
    if (userName) lookUp(userName)
  }

  const { screen } = view
  const ownName = own.kind === 'known' ? own.name : null
  const field = (
    <input
      aria-label="AniList username"
      placeholder="AniList username"
      value={name}
      onChange={(e) => setTyped(e.target.value)}
      aria-invalid={screen.kind === 'search' && screen.error !== null}
      aria-describedby={screen.kind === 'search' && screen.error ? 'st-error' : undefined}
      autoFocus={screen.kind !== 'result'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
    />
  )
  return (
    <>
      <header className="st-hdr">
        <span className="st-logo">
          <Mochi size={34} />
          Top <b>{capital(words.many)}</b>
        </span>
        <a className="st-back" href={sitePage('aniduel')}>
          ← AniDuel!
        </a>
        {screen.kind === 'result' && (
          <form className="st-hdr-form" onSubmit={submit} role="search">
            {field}
            <button type="submit" className="st-go">
              Show
            </button>
          </form>
        )}
      </header>
      {screen.kind === 'result' ? (
        <main className="st-wrap">
          <div className="st-who">
            <h1>
              {screen.userName}’s top {words.many}
            </h1>
            <span className="fine small">
              {screen.ranking.watchedCount} titles watched · {screen.ranking.ranked.length} {words.many} ranked
            </span>
          </div>
          <HowSureCard howSure={screen.howSure} tool={tool} />
          <RankingResult ranking={screen.ranking} cards={screen.cards} tool={tool} Picture={Picture} cardPicture={cardPicture} />
        </main>
      ) : (
        <main className="st-wrap st-search">
          <Mochi size={90} face={screen.kind === 'search' && screen.error ? 'sad' : 'ok'} className={screen.kind === 'loading' ? 'bob' : undefined} />
          <h1>{screen.kind === 'loading' ? `Reading ${screen.userName}’s list…` : `Whose top ${words.many}?`}</h1>
          <form className="st-hero" onSubmit={submit} role="search">
            {field}
            <button type="submit" className="st-go" disabled={screen.kind === 'loading'} aria-label={screen.kind === 'loading' ? 'Loading' : undefined}>
              {screen.kind === 'loading' ? <span className="st-spin" /> : 'Show'}
            </button>
          </form>
          {screen.kind === 'search' && screen.error ? (
            <div className="st-errline" id="st-error" role="alert">
              <p>
                <b>{screen.error.title}</b> {screen.error.body}
              </p>
              {screen.error.retry && load.kind === 'loaded' && (
                <button type="button" className="st-link" onClick={() => setLoad({ kind: 'loading', userName: load.userName })}>
                  Try again
                </button>
              )}
            </div>
          ) : (
            <p className="fine st-intro" aria-live="polite">
              {screen.kind === 'loading' ? words.reading : words.intro}
            </p>
          )}
          {screen.kind === 'search' && ownName && (
            <div className="st-try">
              <span className="fine small">Logged in to AniDuel!?</span>
              <button type="button" onClick={() => lookUp(ownName)}>
                {ownName} (you)
              </button>
            </div>
          )}
        </main>
      )}
    </>
  )
}
