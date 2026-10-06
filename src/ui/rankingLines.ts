import type { BandIndex, RankingState } from '../ranking/engine.ts'
import { formatLevel, levelGroups } from '../ranking/scoring.ts'

/** One line of a Band's Ranking as shown on the Band choice, Complete and sidebar. */
export type RankingLine = {
  key: number
  /** Full Ranking: the place in the whole Ranking. Scores: the score level (#25). */
  mark: string
  ids: readonly number[]
  /** Why several titles share the line, or null for one title. */
  note: string | null
}

/**
 * A Band's Ranking as lines. Full Ranking: one line per Tier, numbered by its place in the whole Ranking. Scores
 * (ADR 0007): one line per score level, best first, since titles on a level have no order (plain level order until
 * #27 groups them by name).
 */
export function rankingLines(state: RankingState, band: BandIndex): RankingLine[] {
  const groups = levelGroups(state, band)
  if (groups && state.scoring) {
    const format = state.scoring.format
    return groups.map(({ level, ids }) => ({
      key: level,
      mark: formatLevel(format, level),
      ids,
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
