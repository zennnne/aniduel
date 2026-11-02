// Top Studios: a username field and a plain ranked table. The chosen layout comes with #92; who is looked up and what
// the page says when it can't rank is decided by studiosView (#91).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { loadTopStudios, type TopStudiosLoad, type TopStudiosSession } from '../loadTopStudios.ts'
import { checkLogin } from '../studiosLogin.ts'
import { StudiosResult } from './StudiosResult.tsx'
import { searchFor, studiosView, type HowSure, type LoadState, type OwnName } from './studiosView.ts'

/** The load a page with this query starts on: the view's `loadNow` already loading, else nothing yet. */
function landingOn(search: string): LoadState {
  const { loadNow } = studiosView({ search, own: { kind: 'none' }, load: { kind: 'idle' } })
  return loadNow ? { kind: 'loading', userName: loadNow } : { kind: 'idle' }
}

export function StudiosPage({ session }: { session: TopStudiosSession }) {
  const [search, setSearch] = useState(() => window.location.search)
  const [own, setOwn] = useState<OwnName>(() => (session.token ? { kind: 'checking' } : { kind: 'none' }))
  // A shared `?user=` link starts loading straight away.
  const [load, setLoad] = useState<LoadState>(() => landingOn(window.location.search))
  // What the user typed; null until they type, so the field shows the view's name (a shared one, or their own).
  const [typed, setTyped] = useState<string | null>(null)
  // The token lookups send: the stored one, dropped once AniList refuses it.
  const token = useRef(session.token)

  const view = studiosView({ search, own, load })

  // Each lookup reads fresh from AniList; one that is no longer the latest is dropped when it lands.
  useEffect(() => {
    if (load.kind !== 'loading') return
    const { userName } = load
    let live = true
    loadTopStudios({ fetch: session.fetch, token: token.current }, userName)
      .catch((error: unknown): TopStudiosLoad => ({ ok: false, failure: { kind: 'api', message: String(error) } }))
      .then((loaded) => live && setLoad({ kind: 'loaded', userName, loaded }))
    return () => void (live = false)
  }, [load, session])

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
      setLoad(landingOn(window.location.search))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const name = typed ?? view.formName

  function submit(event: FormEvent) {
    event.preventDefault()
    const userName = name.trim()
    if (!userName) return
    // The URL carries the name, so the result can be shared as a link.
    const next = searchFor(window.location.search, userName)
    if (next !== window.location.search) window.history.pushState(null, '', next)
    setSearch(next)
    setTyped(null)
    setLoad({ kind: 'loading', userName })
  }

  const { screen } = view
  return (
    <main className="studios">
      <h1>Top Studios</h1>
      <form className="studios-form" onSubmit={submit}>
        <input
          aria-label="AniList username"
          placeholder="AniList username"
          value={name}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={screen.kind === 'loading'}>
          Rank studios
        </button>
      </form>
      {screen.kind === 'search' && screen.error && (
        <div className="studios-error" role="alert">
          <p>
            <strong>{screen.error.title}</strong>
          </p>
          <p>{screen.error.body}</p>
          {screen.error.retry && load.kind === 'loaded' && (
            <button type="button" onClick={() => setLoad({ kind: 'loading', userName: load.userName })}>
              Try again
            </button>
          )}
        </div>
      )}
      {screen.kind === 'loading' && <p>Reading {screen.userName}’s list…</p>}
      {screen.kind === 'result' && (
        <>
          <HowSureCard howSure={screen.howSure} />
          <StudiosResult userName={screen.userName} topStudios={screen.topStudios} />
        </>
      )}
    </main>
  )
}

/** "How sure is this?": always shown, 5 dots and the reasons behind each one taken off. */
function HowSureCard({ howSure }: { howSure: HowSure }) {
  return (
    <section className="studios-sure" aria-label="How sure is this?">
      <p>
        <strong>How sure is this?</strong>{' '}
        <span className="studios-sure-dots" aria-label={`${howSure.dots} of 5`}>
          {'●'.repeat(howSure.dots)}
          <span className="studios-sure-off">{'●'.repeat(5 - howSure.dots)}</span>
        </span>{' '}
        <strong>{howSure.word}</strong>
      </p>
      {howSure.notes.length > 0 ? (
        <ul>
          {howSure.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <p>Plenty of scored titles and 10+ studios ranked.</p>
      )}
    </section>
  )
}
