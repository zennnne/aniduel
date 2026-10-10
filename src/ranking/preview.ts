// Preview (pure): old vs new score for every ranked Pool title, which titles are ticked for Import,
// and the Import plan the write queue writes.
import type { ScoreFormat } from '../anilist/types.ts'
import { compareNames } from '../names.ts'
import { BANDS, type BandIndex, type NewTitlesState, type Prompt, type RankingState } from './engine.ts'
import { levelOfRaw, scoreRawOf, type Scores } from './scoring.ts'
import { isScores } from './sortGoal.ts'

/**
 * Whether Preview can be open on this prompt: every title has its level, or only Refine Duels are left (#29). Those
 * come from a settings change on Scores and leave some titles unsettled; every settled title can still be imported.
 * Under Score New Titles every settled new title can be imported at any time (ADR 0009), so Preview is always open.
 */
export function previewOpen(prompt: Prompt): boolean {
  return prompt.kind === 'all-complete' || prompt.kind === 'anchor-duel' || (prompt.kind === 'duel' && prompt.refine === true)
}

type RowBase = {
  id: number
  /** Null under Score New Titles, which has no Bands (ADR 0009). */
  band: BandIndex | null
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
 * the settled rows by level, best first, and by `name` inside a level, since titles on a level have no order, then
 * the unsettled rows. Preview and a resumed Import pass the same `name`, so both make the same plan.
 */
export function previewRows(
  ranking: RankingState,
  scores: Scores,
  oldScores: ReadonlyMap<number, number>,
  format: ScoreFormat,
  name: (id: number) => string,
): PreviewRow[] {
  if (ranking.newTitles) return newTitlesRows(ranking.newTitles, oldScores, format, name)
  const rows: PreviewRow[] = []
  for (const band of BANDS) {
    const { tiers, unplaced } = ranking.bands[band]
    for (const id of isScores(ranking) ? [...tiers.flat(), ...unplaced] : tiers.flat()) {
      const oldScore100 = oldScores.get(id)
      if (oldScore100 === undefined) continue
      const old = levelOfRaw(format, oldScore100)
      const oldLevel = old === 0 ? null : old
      const scored = scores.titles.get(id)
      const unsettled = scores.unsettled.get(id)
      if (scored) {
        rows.push({ id, band, settled: true, level: scored.level, scoreRaw: scored.scoreRaw, oldScore100, oldLevel, changed: oldLevel !== scored.level })
      } else if (unsettled) {
        rows.push({ id, band, settled: false, levels: unsettled.levels, oldScore100, oldLevel })
      }
    }
  }
  if (!isScores(ranking)) return rows
  return byLevelThenName(rows, name)
}

/** The settled rows by level, best first, and by `name` inside a level (no order was asked there), then the unsettled. */
function byLevelThenName(rows: readonly PreviewRow[], name: (id: number) => string): PreviewRow[] {
  const settled = settledRows(rows)
  settled.sort((x, y) => y.level - x.level || compareNames(name(x.id), name(y.id)))
  return [...settled, ...rows.filter((row) => !row.settled)]
}

/**
 * Score New Titles (ADR 0009): one row per new title still in the Pool, with the Anchor score it settled on. Anchors
 * are never a row, so never written. Scores are the snapshot's levels: written as that raw score, shown at the Score
 * Format AniList reports now (`format`).
 */
function newTitlesRows(
  newTitles: NewTitlesState,
  oldScores: ReadonlyMap<number, number>,
  format: ScoreFormat,
  name: (id: number) => string,
): PreviewRow[] {
  const shown = (level: number) => levelOfRaw(format, scoreRawOf(newTitles.format, level))
  const rows: PreviewRow[] = []
  for (const title of newTitles.titles) {
    const oldScore100 = oldScores.get(title.id)
    if (oldScore100 === undefined) continue
    const old = levelOfRaw(format, oldScore100)
    const base = { id: title.id, band: null, oldScore100, oldLevel: old === 0 ? null : old }
    if (title.settled) {
      const scoreRaw = scoreRawOf(newTitles.format, title.levels[0])
      const level = shown(title.levels[0])
      rows.push({ ...base, settled: true, level, scoreRaw, changed: base.oldLevel !== level })
    } else {
      rows.push({ ...base, settled: false, levels: [...new Set(title.levels.map(shown))] })
    }
  }
  return byLevelThenName(rows, name)
}

/** The settled rows, in the same order: the ones that have a new score (Preview's score rows). */
export function settledRows(rows: readonly PreviewRow[]): SettledRow[] {
  return rows.filter((row) => row.settled)
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

/** One pending score write for the write queue. `oldScore100` lets a resumed Import skip titles changed on AniList since. */
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
