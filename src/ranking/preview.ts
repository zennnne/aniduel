// Preview (pure): old vs new score for every ranked Pool title, which titles are ticked for Import,
// and the Import plan the Import Runner writes.
import type { ScoreFormat } from '../anilist/types.ts'
import { BANDS, type BandIndex, type RankingState } from './engine.ts'
import { levelOfRaw, type Scores } from './scoring.ts'

export type PreviewRow = {
  id: number
  band: BandIndex
  /** The new score: a level of the Score Format and the exact raw sent to AniList. */
  level: number
  scoreRaw: number
  /** The title's AniList score now, on the 100-point scale (0 = no score). */
  oldScore100: number
  /** That score as the Score Format shows it, or null if the title has no score. */
  oldLevel: number | null
  /** Whether the score changes at the Score Format's level (#15). */
  changed: boolean
}

/**
 * One row per title with a place in the Ranking that is still in the Pool, in Ranking order. Forgotten titles
 * have no place, and titles outside the Pool (no entry in `oldScores`) are left out, so neither is ever written.
 */
export function previewRows(
  ranking: RankingState,
  scores: Scores,
  oldScores: ReadonlyMap<number, number>,
  format: ScoreFormat,
): PreviewRow[] {
  const rows: PreviewRow[] = []
  for (const band of BANDS) {
    for (const id of ranking.bands[band].tiers.flat()) {
      const scored = scores.titles.get(id)
      const oldScore100 = oldScores.get(id)
      if (!scored || oldScore100 === undefined) continue
      const old = levelOfRaw(format, oldScore100)
      const oldLevel = old === 0 ? null : old
      rows.push({ id, band, level: scored.level, scoreRaw: scored.scoreRaw, oldScore100, oldLevel, changed: oldLevel !== scored.level })
    }
  }
  return rows
}

/** The user's ticks that differ from the default, by title id. */
export type TickOverrides = ReadonlyMap<number, boolean>

/** Ticked for Import: the user's choice if they made one, otherwise whether the score changes. */
export function isTicked(row: PreviewRow, overrides: TickOverrides): boolean {
  return overrides.get(row.id) ?? row.changed
}

/** One pending write for the Import Runner. `oldScore100` lets a resumed Import skip titles changed on AniList since. */
export type PendingWrite = { mediaId: number; scoreRaw: number; oldScore100: number }

/** The ticked rows as writes, in Ranking order. Only rows can be planned, so Forgotten and outside-Pool titles never are. */
export function importPlan(rows: readonly PreviewRow[], overrides: TickOverrides): PendingWrite[] {
  return rows
    .filter((row) => isTicked(row, overrides))
    .map((row) => ({ mediaId: row.id, scoreRaw: row.scoreRaw, oldScore100: row.oldScore100 }))
}
