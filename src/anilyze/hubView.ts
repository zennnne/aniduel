// The AniLyze hub's view (ADR 0016, look picked in #99): from the AniDuel! login and what the visitor typed, what the
// one username field holds, the line under it, and a card per tool that opens it with that name. Pure: the page
// renders it. The hub fetches nothing for the tools.
import { toolLink, type Tool } from '../sitePages.ts'
import type { OwnName } from './login.ts'

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
  tool: Tool
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

/** The tools that exist, in the hub's order (no "coming soon"). */
const TOOLS: ReadonlyArray<Pick<HubCard, 'tool' | 'icon' | 'name' | 'noun' | 'blurb'>> = [
  { tool: 'studios', icon: '🏢', name: 'Top Studios', noun: 'studios', blurb: 'Ranked from scores, drops, rewatches and favourites.' },
  {
    tool: 'directors',
    icon: '🎬',
    name: 'Top Directors',
    noun: 'directors',
    blurb: 'Same rules as Top Studios, for the people who directed them.',
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
  const cards = TOOLS.map((tool) => ({
    ...tool,
    who: !name ? 'does this fan' : ownNameInField ? 'do you' : `does ${name}`,
    button: !name ? `Open ${tool.name} →` : `Show ${ownNameInField ? 'my' : `${name}’s`} top ${tool.noun} →`,
    href: toolLink(tool.tool, name),
  }))
  return { field, login, cards }
}
