// The AniLyze hub's view (ADR 0016, look picked in #99): from the AniDuel! login and what the visitor typed, what the
// one username field holds, the line under it, and a card per tool that opens it with that name. Pure: the page
// renders it. The hub fetches nothing for the tools.
// The tools' own wording only: their tool.ts files hold no code beyond it, so nothing else of a tool (nor the fake
// AniList) comes into the hub.
import { TOP_DIRECTORS } from '../directors/tool.ts'
import { toolLink } from '../sitePages.ts'
import { TOP_STUDIOS } from '../studios/tool.ts'
import type { OwnName } from './login.ts'
import type { Tool, ToolName } from './tool.ts'

export type HubViewInput = {
  own: OwnName
  /** What the visitor typed; null until they type, so the field shows their own name once the login is known. */
  typed: string | null
}

/** The line under the field. */
export type HubLogin =
  | { kind: 'checking'; keepingTyped: boolean }
  | { kind: 'logged-in'; name: string; ownNameInField: boolean }
  | { kind: 'logged-out' }

export type HubCard = {
  tool: ToolName
  icon: string
  name: string
  noun: string
  blurb: string
  /** "Which {noun} {who} really love?" */
  who: string
  button: string
  href: string
}

export type HubView = { field: string; login: HubLogin; cards: HubCard[] }

/** The tools that exist, in the hub's order (no "coming soon"), each card's name and noun from the tool's own words. */
const TOOLS: ReadonlyArray<Pick<HubCard, 'tool' | 'icon' | 'blurb'> & { words: Tool['words'] }> = [
  { tool: 'studios', icon: '🏢', words: TOP_STUDIOS.words, blurb: 'Ranked from scores, drops, rewatches and favourites.' },
  {
    tool: 'directors',
    icon: '🎬',
    words: TOP_DIRECTORS.words,
    blurb: `Same rules as ${TOP_STUDIOS.words.name}, for the people who directed them.`,
  },
]

export function hubView({ own, typed }: HubViewInput): HubView {
  const field = typed ?? (own.kind === 'known' ? own.name : '')
  const name = field.trim()
  const ownNameInField = own.kind === 'known' && name.toLowerCase() === own.name.toLowerCase()
  const login: HubLogin =
    own.kind === 'checking'
      ? { kind: 'checking', keepingTyped: typed !== null }
      : own.kind === 'known'
        ? { kind: 'logged-in', name: own.name, ownNameInField }
        : { kind: 'logged-out' }
  const cards = TOOLS.map(({ tool, icon, words, blurb }): HubCard => ({
    tool,
    icon,
    name: words.name,
    noun: words.many,
    blurb,
    who: !name ? 'does this fan' : ownNameInField ? 'do you' : `does ${name}`,
    button: !name ? `Open ${words.name} →` : `Show ${ownNameInField ? 'my' : `${name}’s`} top ${words.many} →`,
    href: toolLink(tool, name),
  }))
  return { field, login, cards }
}
