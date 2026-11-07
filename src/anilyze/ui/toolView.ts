// An AniLyze tool page's view (spec #87, Top Studios first): from the URL query, the AniDuel! login (if any) and the
// load, which name to look up, what the search page says, and how sure a result is, in the tool's own words. Pure: the
// page renders it and does what it says.
import { toolLink } from '../../sitePages.ts'
import { pluralWord } from '../../ui/meta.ts'
import type { ToolFailure, ToolLoad } from '../load.ts'
import type { OwnName } from '../login.ts'
import { MIN_SCORED, type ToolResult } from '../scoring.ts'
import type { Tool } from '../tool.ts'
import { rankCards, type CardPicture, type RankCard } from './resultView.ts'

export type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; userName: string }
  | { kind: 'loaded'; userName: string; loaded: ToolLoad }

export type ToolViewInput = {
  /** `location.search`: `?user=<name>` is the share link. */
  search: string
  own: OwnName
  load: LoadState
}

/** What the search page says under the field when a name can't be ranked; `retry` offers to load it again. */
export type FailureMessage = { title: string; body: string; retry: boolean }

/** The "How sure is this?" reading: 5 dots, a word for them, and the notes behind each dot taken off. */
export type HowSure = { dots: number; word: string; notes: string[] }

export type ToolScreen =
  /** The big search: before a result, or with the reason a name couldn't be ranked. */
  | { kind: 'search'; error: FailureMessage | null }
  | { kind: 'loading'; userName: string }
  /** `cards`: the ranked from #1, then the watchlist (#92's layout draws the map and list from them). */
  | { kind: 'result'; userName: string; result: ToolResult; cards: RankCard[]; howSure: HowSure }

export type ToolView = {
  /** A name to load now: a shared `?user=` link before anything has loaded. */
  loadNow: string | null
  /** The name the field holds: the `?user=` one, else the logged-in user's own. */
  formName: string
  screen: ToolScreen
  /** The header's link to the other tool, for the `?user=` looked up (blank when there is none). */
  crossLink: { text: string; href: string }
}

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

export function toolView({ search, own, load }: ToolViewInput, tool: Tool, picture?: CardPicture): ToolView {
  const shared = userOf(search)
  const formName = shared ?? (own.kind === 'known' ? own.name : '')
  const crossLink = { text: tool.crossLink.text, href: toolLink(tool.crossLink.tool, shared ?? '', search) }
  return { loadNow: load.kind === 'idle' ? shared : null, formName, screen: screenOf(load, own, tool, picture), crossLink }
}

function screenOf(load: LoadState, own: OwnName, tool: Tool, picture?: CardPicture): ToolScreen {
  switch (load.kind) {
    case 'idle':
      return { kind: 'search', error: null }
    case 'loading':
      return { kind: 'loading', userName: load.userName }
    case 'loaded': {
      const { userName, loaded } = load
      if (!loaded.ok) return { kind: 'search', error: failureMessage(loaded.failure, userName, own, tool) }
      const { result } = loaded
      return { kind: 'result', userName, result, cards: rankCards(result, picture), howSure: howSure(result, tool) }
    }
  }
}

function failureMessage(failure: ToolFailure, userName: string, own: OwnName, { words }: Tool): FailureMessage {
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
        title: `${userName} has scored only ${failure.scored} ${pluralWord(failure.scored, 'title')}.`,
        body: `${words.name} needs at least ${MIN_SCORED} scored titles to tell ${words.many} apart. Score more on AniList and try again.`,
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

/**
 * −1 when the gate was lowered from the tool's starting Gate, −1 more when fewer rank than the Gate aims for (as too
 * few to compare), −2 when under half the counted titles are scored.
 */
function howSure(result: ToolResult, { words, scoring: { gate } }: Tool): HowSure {
  let dots = 5
  const notes: string[] = []
  if (result.gate < gate.start) {
    dots -= 1
    notes.push(`Your list is short, so a ${words.one} needed only ${result.gate} titles (not ${gate.start}) to be ranked.`)
  }
  if (result.ranked.length < gate.target) {
    dots -= 1
    notes.push(`Only ${result.ranked.length} ${words.many} made it.`)
  }
  const scored = result.countedScoredCount / result.countedCount
  if (scored < 0.5) {
    dots -= 2
    // Rounded down: a list just under half never reads "only 50%".
    notes.push(`You scored only ${Math.floor(scored * 100)}% of the titles that count, so the labels may be off.`)
  }
  return { dots, word: WORDS[dots], notes }
}
