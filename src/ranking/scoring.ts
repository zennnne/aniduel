// Scoring (pure, same seam as the Ranking Engine): turns a Ranking into scores at the levels of the user's
// Score Format (ADR 0003). Bands decide order only; the Distribution decides scores (ADR 0002).
import type { ScoreFormat } from '../anilist/types.ts'
import { BANDS, type BandIndex, type RankingState } from './engine.ts'

export type Distribution = 'linear' | 'bell'

/** `best` and `worst` are levels of the Score Format (e.g. 7.5 on 10 point decimal, 4 on 5 stars). */
export type ScoringSettings = { distribution: Distribution; best: number; worst: number }

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

/** How a Score Format's levels are laid out: `perUnit` levels per whole point, from `min` to `max`. */
type Scale = { perUnit: number; min: number; max: number; raw: (level: number) => number }

const SCALES: Record<ScoreFormat, Scale> = {
  POINT_100: { perUnit: 1, min: 1, max: 100, raw: (n) => n },
  POINT_10_DECIMAL: { perUnit: 10, min: 0.1, max: 10, raw: (n) => Math.round(n * 10) },
  POINT_10: { perUnit: 1, min: 1, max: 10, raw: (n) => n * 10 },
  // The raw AniList itself stores when the user sets that many stars / that smiley (spike #3).
  POINT_5: { perUnit: 1, min: 1, max: 5, raw: (n) => n * 20 - 10 },
  POINT_3: { perUnit: 1, min: 1, max: 3, raw: (n) => [35, 60, 85][n - 1] },
}

/** The nearest level of the Score Format, never below its lowest level (0 would mean "no score"). */
function toLevel(format: ScoreFormat, value: number): number {
  const { perUnit, min, max } = SCALES[format]
  return Math.min(max, Math.max(min, Math.round(value * perUnit) / perUnit))
}

/** The exact `scoreRaw` AniList stores for a level of this Score Format (ADR 0003). */
export function scoreRawOf(format: ScoreFormat, level: number): number {
  return SCALES[format].raw(level)
}

/** Every level of the Score Format a title can get, highest first. 0 ("no score") is never one of them. */
export function levels(format: ScoreFormat): number[] {
  const { perUnit, min, max } = SCALES[format]
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

export function defaultSettings(format: ScoreFormat): ScoringSettings {
  return { distribution: 'linear', ...DEFAULTS[format] }
}

/**
 * Best and worst carried over to a new Score Format (the user changed it on AniList, ADR 0003): each goes
 * through its raw score and is read the way AniList would show it. Worst never becomes 0 and stays below best.
 */
export function convertSettings(settings: ScoringSettings, from: ScoreFormat, to: ScoreFormat): ScoringSettings {
  const { perUnit, min } = SCALES[to]
  const step = 1 / perUnit
  const convert = (level: number) => toLevel(to, levelOfRaw(to, scoreRawOf(from, level)))
  let best = convert(settings.best)
  let worst = convert(settings.worst)
  if (worst >= best) {
    if (best <= min) best = toLevel(to, min + step)
    worst = toLevel(to, best - step)
  }
  return { distribution: settings.distribution, best, worst }
}

/** Scoring settings as saved, with the Score Format they were chosen in. */
export type SavedScoring = { format: ScoreFormat; settings: ScoringSettings }

/** Saved scoring settings read back from storage or a Backup file, or null if they don't make sense. */
export function parseSavedScoring(value: unknown): SavedScoring | null {
  const v = value as Partial<SavedScoring> | null
  const format = v?.format
  if (typeof format !== 'string' || !(format in SCALES)) return null
  const { distribution, best, worst } = (v?.settings ?? {}) as Partial<ScoringSettings>
  if (distribution !== 'linear' && distribution !== 'bell') return null
  const valid = levels(format)
  if (typeof best !== 'number' || typeof worst !== 'number' || !valid.includes(best) || !valid.includes(worst) || worst >= best) {
    return null
  }
  return { format, settings: { distribution, best, worst } }
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

export function score(ranking: RankingState, format: ScoreFormat, settings: ScoringSettings): Scores {
  const tiers = BANDS.flatMap((band) => ranking.bands[band].tiers.map((members) => ({ band, members })))
  const n = tiers.reduce((sum, t) => sum + t.members.length, 0)
  const titles = new Map<number, TitleScore>()
  const bands: (LevelRange | null)[] = BANDS.map(() => null)
  let position = 0
  for (const tier of tiers) {
    const average = position + (tier.members.length - 1) / 2
    const level = toLevel(format, rawValue(average, n, settings))
    const scoreRaw = scoreRawOf(format, level)
    for (const id of tier.members) titles.set(id, { band: tier.band, level, scoreRaw })
    position += tier.members.length
    const range = bands[tier.band]
    bands[tier.band] = range ? { min: Math.min(range.min, level), max: Math.max(range.max, level) } : { min: level, max: level }
  }
  return { titles, bands }
}
