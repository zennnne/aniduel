// Preview (pure): old vs new score for every ranked Pool title, which titles are ticked for Import,
// and the Import plan the Import Runner writes.
import type { ScoreFormat } from '../anilist/types.ts'
import { BANDS, type BandIndex, type Prompt, type RankingState } from './engine.ts'
import { levelOfRaw, type Scores } from './scoring.ts'

/**
 * Whether Preview can be open on this prompt: every title has its level, or only Refine Duels are left (#29). Those
 * come from a settings change on Scores and leave some titles unsettled; every settled title can still be imported.
 */
export function previewOpen(prompt: Prompt): boolean {
  return prompt.kind === 'all-complete' || (prompt.kind === 'duel' && prompt.refine === true)
}

type RowBase = {
  id: number
  band: BandIndex
  /** The title's AniList score now, on the 100-point scale (0 = no score). */
  oldScore100: number
  /** That score as the Score Format shows it, or null if the title has no score. */
  oldLevel: number | null
}

/** A title whose new score no further Duel can change: it can be ticked and imported. */
export type SettledRow = RowBase & {
  settled: true
  /** The new score: a level of the Score Format and the exact raw sent to AniList. */
  level: number
  scoreRaw: number
  /** Whether the score changes at the Score Format's level (#15). */
  changed: boolean
}

/**
 * Scores only (ADR 0007): a title whose level is not settled under the current settings (e.g. after a settings
 * change). It has no new score, so it can never be ticked or imported until Refine Duels settle it.
 */
export type UnsettledRow = RowBase & {
  settled: false
  /** The levels it can still get, best first (at least two). */
  levels: readonly number[]
}

export type PreviewRow = SettledRow | UnsettledRow

/**
 * One row per title in the Ranking that is still in the Pool. Forgotten titles have no place, and titles outside
 * the Pool (no entry in `oldScores`) are left out, so neither is ever written.
 * Full Ranking: every row is settled, in Ranking order. Scores (ADR 0007): every title in a Band, settled or not:
 * the settled rows by level, best first, and by `name` inside a level, since titles on a level have no order (Ranking
 * order when no `name` is given), then the unsettled rows.
 */
export function previewRows(
  ranking: RankingState,
  scores: Scores,
  oldScores: ReadonlyMap<number, number>,
  format: ScoreFormat,
  name?: (id: number) => string,
): PreviewRow[] {
  const rows: PreviewRow[] = []
  for (const band of BANDS) {
    const { tiers, unplaced } = ranking.bands[band]
    for (const id of ranking.standing ? [...tiers.flat(), ...unplaced] : tiers.flat()) {
      const oldScore100 = oldScores.get(id)
      if (oldScore100 === undefined) continue
      const old = levelOfRaw(format, oldScore100)
      const oldLevel = old === 0 ? null : old
      const scored = scores.titles.get(id)
      const open = scores.unsettled.get(id)
      if (scored) {
        rows.push({ id, band, settled: true, level: scored.level, scoreRaw: scored.scoreRaw, oldScore100, oldLevel, changed: oldLevel !== scored.level })
      } else if (open) {
        rows.push({ id, band, settled: false, levels: open.levels, oldScore100, oldLevel })
      }
    }
  }
  if (!ranking.standing) return rows
  const settled = settledRows(rows)
  // Sorting is stable: without names, titles on a level keep their Ranking order.
  const byName = name ? (x: SettledRow, y: SettledRow) => compareNames(name(x.id), name(y.id)) : () => 0
  settled.sort((x, y) => y.level - x.level || byName(x, y))
  return [...settled, ...rows.filter((row) => !row.settled)]
}

/** The settled rows, in the same order: the ones that have a new score (Preview's score rows). */
export function settledRows(rows: readonly PreviewRow[]): SettledRow[] {
  return rows.filter((row) => row.settled)
}

/** Display names in alphabetical order, ignoring case and accents, with numbers in numeric order. */
export function compareNames(x: string, y: string): number {
  return x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true })
}

/** The user's ticks that differ from the default, by title id. */
export type TickOverrides = ReadonlyMap<number, boolean>

/**
 * Ticked for Import: the user's choice if they made one, otherwise whether the score changes. Never an unsettled
 * row, whatever the overrides say.
 */
export function isTicked(row: PreviewRow, overrides: TickOverrides): row is SettledRow {
  return row.settled && (overrides.get(row.id) ?? row.changed)
}

/** One pending write for the Import Runner. `oldScore100` lets a resumed Import skip titles changed on AniList since. */
export type PendingWrite = { mediaId: number; scoreRaw: number; oldScore100: number }

/**
 * The ticked rows as writes, in row order. Only settled rows can be planned, so unsettled, Forgotten and outside-Pool
 * titles never are.
 */
export function importPlan(rows: readonly PreviewRow[], overrides: TickOverrides): PendingWrite[] {
  return rows
    .filter((row) => isTicked(row, overrides))
    .map((row) => ({ mediaId: row.id, scoreRaw: row.scoreRaw, oldScore100: row.oldScore100 }))
}
