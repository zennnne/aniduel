// Top Studios, the tracer (#88): a username field and a plain ranked table. The chosen layout comes with #92.
import { useRef, useState, type FormEvent } from 'react'
import { loadTopStudios, type TopStudiosFailure, type TopStudiosLoad, type TopStudiosSession } from '../loadTopStudios.ts'
import { StudiosResult } from './StudiosResult.tsx'

type PageState =
  | { kind: 'idle' }
  | { kind: 'loading'; userName: string }
  | { kind: 'loaded'; userName: string; loaded: TopStudiosLoad }

function failureMessage(failure: TopStudiosFailure): string {
  switch (failure.kind) {
    case 'no-such-user':
      return 'No AniList user by that name.'
    case 'private-list':
      return 'That list is private.'
    case 'too-few-scored':
      return `Only ${failure.scored} scored titles: too few to rank studios.`
    case 'rate-limited':
      return 'AniList is busy right now. Try again in a minute.'
    case 'unreachable':
      return 'AniList can’t be reached. Try again.'
    case 'invalid-token':
      return 'AniList refused the login token.'
    case 'api':
      return `AniList answered with an error: ${failure.message}`
  }
}

export function StudiosPage({ session }: { session: TopStudiosSession }) {
  const [name, setName] = useState('')
  const [state, setState] = useState<PageState>({ kind: 'idle' })
  const latest = useRef(0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const userName = name.trim()
    if (!userName) return
    const request = ++latest.current
    setState({ kind: 'loading', userName })
    const loaded = await loadTopStudios(session, userName).catch(
      (error: unknown): TopStudiosLoad => ({ ok: false, failure: { kind: 'api', message: String(error) } }),
    )
    if (request === latest.current) setState({ kind: 'loaded', userName, loaded })
  }

  return (
    <main className="studios">
      <h1>Top Studios</h1>
      <form className="studios-form" onSubmit={submit}>
        <input
          aria-label="AniList username"
          placeholder="AniList username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={state.kind === 'loading'}>
          Rank studios
        </button>
      </form>
      {state.kind === 'loading' && <p>Reading {state.userName}’s list…</p>}
      {state.kind === 'loaded' && !state.loaded.ok && <p role="alert">{failureMessage(state.loaded.failure)}</p>}
      {state.kind === 'loaded' && state.loaded.ok && (
        <StudiosResult userName={state.userName} topStudios={state.loaded.topStudios} />
      )}
    </main>
  )
}
