import { compareNames } from '../names.ts'
import type { BandIndex, RankingState } from '../ranking/engine.ts'
import { formatLevel, levelGroups } from '../ranking/scoring.ts'

/** One line of a Band's Ranking as shown on the Band choice, Complete and sidebar. */
export type RankingLine = {
  key: number
  /** Full Ranking: the place in the whole Ranking. Scores: the score level (#25). */
  mark: string
  /** Full Ranking: a Tier, in the order its titles joined it. Scores: the level's titles, sorted by name. */
  ids: readonly number[]
  /** Why several titles share the line, or null for one title. */
  note: string | null
}

/** One score of a Score New Titles Ranking (ADR 0009), as the sidebar and Complete show it. */
export type NewTitlesLine = {
  level: number
  /** The score as the Anchor snapshot's Score Format shows it. */
  mark: string
  /** A few of the score's Anchors to show (none for a score no Anchor has), and how many more it has. */
  anchors: readonly number[]
  more: number
  /** The settled new titles on it, sorted by `name`: they have no order among themselves. */
  ids: readonly number[]
}

/** Anchors shown per score, on the sidebar and the Closer-to prompt. */
const ANCHORS_SHOWN = 3

/**
 * The Anchors to show for a score, the same ones wherever it is shown, and how many more it has. Never Forgotten or
 * Suspect ones: they are no longer a reference.
 */
export function shownAnchors(state: RankingState, level: number): { shown: number[]; more: number } {
  const newTitles = state.newTitles
  if (!newTitles) return { shown: [], more: 0 }
  const unused = new Set([...state.forgotten, ...newTitles.suspect.map((s) => s.id)])
  const usable = (newTitles.levels.find((l) => l.level === level)?.anchors ?? []).filter((id) => !unused.has(id))
  const shown = usable.slice(0, ANCHORS_SHOWN)
  return { shown, more: usable.length - shown.length }
}

/**
 * Under Score New Titles: one line per Anchor score, best first, plus any score a settled title got that no Anchor
 * has: a score one step past the extreme Anchors (#48), once a title landed on it. Empty on any other Sort Goal.
 */
export function newTitlesLines(state: RankingState, name: (id: number) => string): NewTitlesLine[] {
  const newTitles = state.newTitles
  if (!newTitles) return []
  const anchorLevels = newTitles.levels.map((l) => l.level)
  const settled = new Map<number, number[]>()
  for (const title of newTitles.titles) {
    if (title.settled) settled.set(title.levels[0], [...(settled.get(title.levels[0]) ?? []), title.id])
  }
  return [...new Set([...anchorLevels, ...settled.keys()])]
    .sort((x, y) => y - x)
    .map((level) => {
      const { shown, more } = shownAnchors(state, level)
      return {
        level,
        mark: formatLevel(newTitles.format, level),
        anchors: shown,
        more,
        ids: [...(settled.get(level) ?? [])].sort((x, y) => compareNames(name(x), name(y))),
      }
    })
}

/**
 * A Band's Ranking as lines. Full Ranking: one line per Tier, numbered by its place in the whole Ranking. Scores
 * (ADR 0007): one line per score level, best first, its titles sorted by `name`, since they have no order (#25).
 */
export function rankingLines(state: RankingState, band: BandIndex, name: (id: number) => string): RankingLine[] {
  const groups = levelGroups(state, band)
  if (groups && state.scoring) {
    const format = state.scoring.format
    return groups.map(({ level, ids }) => ({
      key: level,
      mark: formatLevel(format, level),
      ids: [...ids].sort((x, y) => compareNames(name(x), name(y))),
      note: ids.length > 1 ? 'same score · no order' : null,
    }))
  }
  // Place of the Band's first Tier in the whole Ranking (a Tier is one place).
  const first = state.bands.slice(0, band).reduce((sum, b) => sum + b.tiers.length, 1)
  return state.bands[band].tiers.map((tier, i) => ({
    key: tier[0],
    mark: String(first + i),
    ids: tier,
    note: tier.length > 1 ? 'Tier · same score' : null,
  }))
}
