// The Top Studios page's view (spec #87): from the URL query, the AniDuel! login (if any) and the load, which name to
// look up, what the search page says, and how sure a result is. Pure: the page renders it and does what it says.
import { GATE, type TopStudios, type TopStudiosFailure, type TopStudiosLoad } from '../loadTopStudios.ts'

/** The logged-in AniDuel! user's own name: still being checked, known, or none (logged out, or the login refused). */
export type OwnName = { kind: 'checking' } | { kind: 'known'; name: string } | { kind: 'none' }

export type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; userName: string }
  | { kind: 'loaded'; userName: string; loaded: TopStudiosLoad }

export type StudiosViewInput = {
  /** `location.search`: `?user=<name>` is the share link. */
  search: string
  own: OwnName
  load: LoadState
}

/** What the search page says under the field when a name can't be ranked; `retry` offers to load it again. */
export type FailureMessage = { title: string; body: string; retry: boolean }

/** The "How sure is this?" reading: 5 dots, a word for them, and the notes behind each dot taken off. */
export type HowSure = { dots: number; word: string; notes: string[] }

export type StudiosScreen =
  /** The big search: before a result, or with the reason a name couldn't be ranked. */
  | { kind: 'search'; error: FailureMessage | null }
  | { kind: 'loading'; userName: string }
  | { kind: 'result'; userName: string; topStudios: TopStudios; howSure: HowSure }

export type StudiosView = {
  /** A name to load now: a shared `?user=` link before anything has loaded. */
  loadNow: string | null
  /** The name the field holds: the `?user=` one, else the logged-in user's own. */
  formName: string
  screen: StudiosScreen
}

/** The gate every list starts at (v2.7); a short list steps it down, which the reading counts against. */
const FULL_GATE = GATE
/** Fewer ranked studios than this rest on too little to compare. */
const FEW_RANKED = 10
const WORDS = ['', 'Very rough', 'Rough', 'Fair', 'Good', 'Solid']

/** The name in `?user=`, or null when there is none. */
export function userOf(search: string): string | null {
  return new URLSearchParams(search).get('user')?.trim() || null
}

/** The query for a lookup of `userName`, the share link: `?user=` set, the rest of the query kept. */
export function searchFor(search: string, userName: string): string {
  const params = new URLSearchParams(search)
  params.set('user', userName)
  return `?${params}`
}

export function studiosView({ search, own, load }: StudiosViewInput): StudiosView {
  const shared = userOf(search)
  const formName = shared ?? (own.kind === 'known' ? own.name : '')
  return { loadNow: load.kind === 'idle' ? shared : null, formName, screen: screenOf(load, own) }
}

function screenOf(load: LoadState, own: OwnName): StudiosScreen {
  switch (load.kind) {
    case 'idle':
      return { kind: 'search', error: null }
    case 'loading':
      return { kind: 'loading', userName: load.userName }
    case 'loaded': {
      const { loaded, userName } = load
      if (!loaded.ok) return { kind: 'search', error: failureMessage(loaded.failure, userName, own) }
      return { kind: 'result', userName, topStudios: loaded.topStudios, howSure: howSure(loaded.topStudios) }
    }
  }
}

function failureMessage(failure: TopStudiosFailure, userName: string, own: OwnName): FailureMessage {
  switch (failure.kind) {
    case 'no-such-user':
      return {
        title: `There’s no AniList user called “${userName}”.`,
        body: 'Check the spelling: it’s the name in their AniList profile link.',
        retry: false,
      }
    case 'private-list':
      return {
        title: `${userName}’s list is private.`,
        // A logged-in user's own private list loads with their token, so a refusal is someone else's list.
        body:
          own.kind === 'known'
            ? 'AniList shows it only to them.'
            : 'If it’s yours, log in on AniDuel! first: this page then reads it with your login.',
        retry: false,
      }
    case 'too-few-scored':
      return {
        title: `${userName} has scored only ${failure.scored} title${failure.scored === 1 ? '' : 's'}.`,
        body: 'Top Studios needs at least 10 scored titles to tell studios apart. Score more on AniList and try again.',
        retry: false,
      }
    case 'rate-limited':
      return {
        title: 'AniList is busy right now.',
        body: 'It takes only so many requests a minute. Wait a moment, then try again.',
        retry: true,
      }
    case 'unreachable':
      return { title: 'AniList can’t be reached.', body: 'Check your connection; AniList may also be down for a while.', retry: true }
    case 'api':
      return { title: 'AniList answered with an error.', body: failure.message, retry: true }
  }
}

/** −1 when the gate was lowered, −1 more when fewer than 10 studios rank, −2 when under half the counted titles are scored. */
function howSure(result: TopStudios): HowSure {
  let dots = 5
  const notes: string[] = []
  if (result.gate < FULL_GATE) {
    dots -= 1
    notes.push(`Your list is short, so a studio needed only ${result.gate} titles (not ${FULL_GATE}) to be ranked.`)
  }
  if (result.studios.length < FEW_RANKED) {
    dots -= 1
    notes.push(`Only ${result.studios.length} studios made it.`)
  }
  const scored = result.countedScoredCount / result.countedCount
  if (scored < 0.5) {
    dots -= 2
    // Rounded down: a list just under half never reads "only 50%".
    notes.push(`You scored only ${Math.floor(scored * 100)}% of the titles that count, so the labels may be off.`)
  }
  return { dots, word: WORDS[dots], notes }
}
