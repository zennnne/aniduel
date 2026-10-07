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
