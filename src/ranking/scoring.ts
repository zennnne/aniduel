// Scoring (pure, same seam as the Ranking Engine): turns a Ranking into scores at the levels of the user's
// Score Format (ADR 0003). Bands decide order only; the Distribution decides scores (ADR 0002).
import type { ScoreFormat } from '../anilist/types.ts'
// Types only: the engine imports this module (scoring settings are Duel log events, ADR 0007).
import type { BandIndex, LogEvent, RankingState } from './engine.ts'

export type Distribution = 'linear' | 'bell'

/**
 * Every level of the Score Format ('fine'), only every 0.5 / every 5 points ('human'), or only whole points, every
 * 1 / every 10 ('whole', the Scores Sort Goal's step, ADR 0007). Formats without decimals have only one step.
 */
export type ScoreStep = 'fine' | 'human' | 'whole'
const SCORE_STEPS: readonly ScoreStep[] = ['fine', 'human', 'whole']

/** `best` and `worst` are levels of the Score Format on the Score Step (e.g. 7.5 on 10 point decimal, 4 on 5 stars). */
export type ScoringSettings = { distribution: Distribution; step: ScoreStep; best: number; worst: number }

export type TitleScore = { band: BandIndex; level: number; scoreRaw: number }

export type LevelRange = { min: number; max: number }

export type Scores = {
  /** Every title with a place in the Ranking (Forgotten and unplaced titles have none). */
  titles: ReadonlyMap<number, TitleScore>
  /** Per Band (index = BandIndex): the range of levels its titles get, or null if it has none (ADR 0002). */
  bands: readonly (LevelRange | null)[]
}

/** Inverse of the standard normal CDF (Acklam's rational approximation, relative error < 1.15e-9). */
function inverseNormal(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const low = 0.02425
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - low) return -inverseNormal(1 - p)
  const q = p - 0.5
  const r = q * q
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  )
}

/** The unrounded score for a (Tier average) position among n titles. */
function rawValue(position: number, n: number, settings: ScoringSettings): number {
  const { best, worst } = settings
  if (settings.distribution === 'linear') {
    return n === 1 ? best : best - (position / (n - 1)) * (best - worst)
  }
  const p = (position + 0.5) / n
  const value = (best + worst) / 2 + inverseNormal(1 - p) * ((best - worst) / 4)
  return Math.min(best, Math.max(worst, value))
}

/**
 * How a Score Format's levels are laid out: `perUnit` levels per whole point, from `min` to `max`.
 * `humanPerUnit` and `wholePerUnit` are the coarser 'human' and 'whole' Score Steps, for formats that have them.
 */
type Scale = { perUnit: number; humanPerUnit?: number; wholePerUnit?: number; min: number; max: number; raw: (level: number) => number }

const SCALES: Record<ScoreFormat, Scale> = {
  POINT_100: { perUnit: 1, humanPerUnit: 0.2, wholePerUnit: 0.1, min: 1, max: 100, raw: (n) => n },
  POINT_10_DECIMAL: { perUnit: 10, humanPerUnit: 2, wholePerUnit: 1, min: 0.1, max: 10, raw: (n) => Math.round(n * 10) },
  POINT_10: { perUnit: 1, min: 1, max: 10, raw: (n) => n * 10 },
  // The raw AniList itself stores when the user sets that many stars / that smiley (spike #3).
  POINT_5: { perUnit: 1, min: 1, max: 5, raw: (n) => n * 20 - 10 },
  POINT_3: { perUnit: 1, min: 1, max: 3, raw: (n) => [35, 60, 85][n - 1] },
}

/** Levels per whole point and the lowest level at this Score Step (0 is never a level: it means "no score"). */
function stepOf(format: ScoreFormat, step: ScoreStep): { perUnit: number; min: number } {
  const { perUnit, humanPerUnit, wholePerUnit, min } = SCALES[format]
  const coarser = step === 'human' ? humanPerUnit : step === 'whole' ? wholePerUnit : undefined
  return coarser ? { perUnit: coarser, min: 1 / coarser } : { perUnit, min }
}

/** Whether this Score Format lets the user choose a Score Step (10 point decimal and 100 point). */
export function hasHumanStep(format: ScoreFormat): boolean {
  return SCALES[format].humanPerUnit !== undefined
}

/** The gap between levels at this Score Step, as the Score Format shows it: "0.1", "0.5", "1", "5". */
export function stepLabel(format: ScoreFormat, step: ScoreStep): string {
  return String(1 / stepOf(format, step).perUnit)
}

/** The nearest level of the Score Format on the Score Step, never below its lowest level. */
function toLevel(format: ScoreFormat, value: number, step: ScoreStep = 'fine'): number {
  const { max } = SCALES[format]
  const { perUnit, min } = stepOf(format, step)
  return Math.min(max, Math.max(min, Math.round(value * perUnit) / perUnit))
}

/** The exact `scoreRaw` AniList stores for a level of this Score Format (ADR 0003). */
export function scoreRawOf(format: ScoreFormat, level: number): number {
  return SCALES[format].raw(level)
}

/** Every level of the Score Format a title can get at this Score Step, highest first. 0 ("no score") is never one of them. */
export function levels(format: ScoreFormat, step: ScoreStep = 'fine'): number[] {
  const { max } = SCALES[format]
  const { perUnit, min } = stepOf(format, step)
  const out: number[] = []
  for (let step = Math.round(max * perUnit); step >= Math.round(min * perUnit); step--) out.push(step / perUnit)
  return out
}

/** The level AniList shows for a stored raw score in this Score Format; 0 means no score. */
export function levelOfRaw(format: ScoreFormat, raw: number): number {
  if (raw <= 0) return 0
  switch (format) {
    case 'POINT_100':
      return raw
    case 'POINT_10_DECIMAL':
      return Math.round(raw) / 10
    case 'POINT_10':
      return Math.floor(raw / 10) // AniList always rounds down (ADR 0003)
    case 'POINT_5':
      return Math.round(raw / 20) // nearest star
    case 'POINT_3':
      return raw <= 35 ? 1 : raw <= 60 ? 2 : 3 // thresholds found by spike #3
  }
}

const SMILEYS = ['🙁', '😐', '🙂']

/** A level as the Score Format shows it: "85", "7.5", "7", "★★★", "🙂". */
export function formatLevel(format: ScoreFormat, level: number): string {
  switch (format) {
    case 'POINT_10_DECIMAL':
      return level.toFixed(1)
    case 'POINT_5':
      return '★'.repeat(level)
    case 'POINT_3':
      return SMILEYS[level - 1] ?? String(level)
    default:
      return String(level)
  }
}

const DEFAULTS: Record<ScoreFormat, { best: number; worst: number }> = {
  POINT_100: { best: 95, worst: 30 },
  POINT_10_DECIMAL: { best: 10, worst: 3 },
  POINT_10: { best: 10, worst: 3 },
  POINT_5: { best: 5, worst: 1 },
  POINT_3: { best: 3, worst: 1 },
}

/** The default settings on a Score Step: 'human' for Full Ranking, 'whole' for Scores (best and worst snapped to it). */
export function defaultSettings(format: ScoreFormat, step: ScoreStep = 'human'): ScoringSettings {
  return withStep({ distribution: 'linear', step: 'human', ...DEFAULTS[format] }, format, step)
}

/** Best and worst moved to the nearest levels on the Score Step, worst still below best. */
function onStep(format: ScoreFormat, settings: ScoringSettings, best: number, worst: number): ScoringSettings {
  const { perUnit, min } = stepOf(format, settings.step)
  const gap = 1 / perUnit
  best = toLevel(format, best, settings.step)
  worst = toLevel(format, worst, settings.step)
  if (worst >= best) {
    if (best <= min) best = toLevel(format, min + gap, settings.step)
    worst = toLevel(format, best - gap, settings.step)
  }
  return { ...settings, best, worst }
}

/** The settings with another Score Step: best and worst move to the nearest levels on it (9.7 → 9.5). */
export function withStep(settings: ScoringSettings, format: ScoreFormat, step: ScoreStep): ScoringSettings {
  return onStep(format, { ...settings, step }, settings.best, settings.worst)
}

/**
 * Best and worst carried over to a new Score Format (the user changed it on AniList, ADR 0003): each goes
 * through its raw score and is read the way AniList would show it. Worst never becomes 0 and stays below best.
 * The Score Step stays 'fine', 'human' or 'whole', whatever gap that means in the new Score Format.
 */
export function convertSettings(settings: ScoringSettings, from: ScoreFormat, to: ScoreFormat): ScoringSettings {
  const convert = (level: number) => levelOfRaw(to, scoreRawOf(from, level))
  return onStep(to, settings, convert(settings.best), convert(settings.worst))
}

/** Scoring settings as saved, with the Score Format they were chosen in. */
export type SavedScoring = { format: ScoreFormat; settings: ScoringSettings }

/** Saved scoring settings read back from storage or a Backup file, or null if they don't make sense. */
export function parseSavedScoring(value: unknown): SavedScoring | null {
  const v = value as Partial<SavedScoring> | null
  const format = v?.format
  if (typeof format !== 'string' || !(format in SCALES)) return null
  // Settings saved before the Score Step existed were 'fine', so the scores they gave don't change.
  const { distribution, step = 'fine', best, worst } = (v?.settings ?? {}) as Partial<ScoringSettings>
  if (distribution !== 'linear' && distribution !== 'bell') return null
  if (!SCORE_STEPS.includes(step)) return null
  const valid = levels(format, step)
  if (typeof best !== 'number' || typeof worst !== 'number' || !valid.includes(best) || !valid.includes(worst) || worst >= best) {
    return null
  }
  return { format, settings: { distribution, step, best, worst } }
}

/**
 * The settings to use with the Score Format AniList reports now (run `Viewer` first). `converted` is true when
 * the saved settings were made for another Score Format and had to be converted (ADR 0003): tell the user.
 */
export function settingsFor(saved: SavedScoring | null, format: ScoreFormat): { settings: ScoringSettings; converted: boolean } {
  if (!saved) return { settings: defaultSettings(format), converted: false }
  if (saved.format === format) return { settings: saved.settings, converted: false }
  return { settings: convertSettings(saved.settings, saved.format, format), converted: true }
}

/**
 * The scoring settings a Ranking uses with the Score Format AniList reports now (run `Viewer` first): its log's
 * own (ADR 0007), or for an older log without any, the settings saved outside it. If they were made for another
 * Score Format they are converted (ADR 0003): `converted` is true, tell the user, and append `event` so the
 * conversion travels with the log.
 */
export function scoringFor(
  ranking: Pick<RankingState, 'scoring'>,
  saved: SavedScoring | null,
  format: ScoreFormat,
): { settings: ScoringSettings; converted: boolean; event: Extract<LogEvent, { type: 'scoring-set' }> | null } {
  const { settings, converted } = settingsFor(ranking.scoring ?? saved, format)
  return { settings, converted, event: converted ? { type: 'scoring-set', format, settings } : null }
}

/**
 * The level a (Tier average) position among n titles gets. Never increases with the position, so a title whose
 * possible positions all give one level is settled (ADR 0007): the engine and `score` both decide that here.
 */
export function levelAt(format: ScoreFormat, settings: ScoringSettings, position: number, n: number): number {
  return toLevel(format, rawValue(position, n, settings), settings.step)
}

/**
 * Every title's level. Full Ranking: by its Tier's average position among the titles with a place. Scores
 * (`ranking.standing`, ADR 0007): only settled titles get a level, the one every position still open to them gives,
 * among every title in a Band; unsettled titles get none.
 */
export function score(ranking: RankingState, format: ScoreFormat, settings: ScoringSettings): Scores {
  const titles = new Map<number, TitleScore>()
  const bands: (LevelRange | null)[] = ranking.bands.map(() => null)
  const add = (id: number, band: BandIndex, level: number) => {
    titles.set(id, { band, level, scoreRaw: scoreRawOf(format, level) })
    const range = bands[band]
    bands[band] = range ? { min: Math.min(range.min, level), max: Math.max(range.max, level) } : { min: level, max: level }
  }
  const standing = ranking.standing
  if (standing) {
    for (const [id, { band, min, max }] of standing.titles) {
      const level = levelAt(format, settings, min, standing.size)
      if (level === levelAt(format, settings, max, standing.size)) add(id, band, level)
    }
    return { titles, bands }
  }
  const tiers = ranking.bands.flatMap((b, band) => b.tiers.map((members) => ({ band: band as BandIndex, members })))
  const n = tiers.reduce((sum, t) => sum + t.members.length, 0)
  let position = 0
  for (const tier of tiers) {
    const level = levelAt(format, settings, position + (tier.members.length - 1) / 2, n)
    for (const id of tier.members) add(id, tier.band, level)
    position += tier.members.length
  }
  return { titles, bands }
}

/** A score level and the titles on it. */
export type LevelGroup = { level: number; ids: readonly number[] }

/**
 * On Scores (ADR 0007): a Band's settled titles grouped by level, best first, under the log's own scoring settings.
 * Titles in a group have no order among themselves; they are listed in Ranking order (Tiers, then titles without
 * a place), and the UI sorts them by name. Null on Full Ranking, where every title has its own place.
 */
export function levelGroups(ranking: RankingState, band: BandIndex): LevelGroup[] | null {
  if (!ranking.standing || !ranking.scoring) return null
  const { titles } = score(ranking, ranking.scoring.format, ranking.scoring.settings)
  const byLevel = new Map<number, number[]>()
  for (const id of [...ranking.bands[band].tiers.flat(), ...ranking.bands[band].unplaced]) {
    const level = titles.get(id)?.level
    if (level === undefined) continue
    const group = byLevel.get(level)
    if (group) group.push(id)
    else byLevel.set(level, [id])
  }
  return [...byLevel].sort((x, y) => y[0] - x[0]).map(([level, ids]) => ({ level, ids }))
}
