// Studio Score v2.7 (research spec docs/research/top-studio-score.md, prototype scripts/top-studio-score/prototype.py).
// Pure: takes the user's list entries and favourite anime, returns the ranked studios. No I/O.
import type { ListStatus } from '../anilist/types.ts'
import type { StudioTitle } from './types.ts'

/** α: how far the entropic mean leans toward a studio's best titles. At α → 0 it is a plain mean. */
const ALPHA = 1
/** Below this many scored titles there is no scale to read z from: the list is too little to rank. */
export const MIN_SCORED = 10
/** The SD never counts as smaller than this, so a user who scores everything alike doesn't blow z up. */
const SD_FLOOR = 0.5
/** Added to the z of a favourite anime (flat: most users don't rank their favourites). */
const FAV_BONUS = 0.5
/** A scored drop counts at most this z. */
const DROP_Z_CAP = -0.5
/** Unscored titles count only through a signal the user gave: a drop or a rewatch. */
const UNSCORED_DROP_Z = -1
const UNSCORED_REWATCH_Z = 0.5
/** Titles closer than this to the user's mean (|z|) weigh half: neutral titles shouldn't drag a studio much. */
const MID_BAND = 0.5
const MID_WEIGHT = 0.5
/** An unscored drop weighs half: it says less than a real score. */
const UNSCORED_DROP_WEIGHT = 0.5
/** Pseudo-votes at the user's average every studio starts with: "a studio needs this much evidence". */
const K = 13.1
/** Entries a studio needs to be ranked. Fixed here; the step-down for short lists comes with #90. */
const GATE = 6

/** One counted title in one studio's score. */
export type StudioVote = {
  title: StudioTitle
  /** How much the user liked it, in SDs from their mean (status defaults and the fav bonus included). */
  z: number
  /** Its vote weight W: √(runtime weight), rescaled so the mean W over every vote of every studio is 1. */
  weight: number
  favourite: boolean
  /** Whether z comes from a score, not from a drop or rewatch default. */
  scored: boolean
}

export type StudioScore = {
  id: number
  name: string
  /** The Studio Score S. 0 is an average studio for this user. */
  score: number
  /** The counted titles, in list order. Their count is the studio's entries, which the gate reads. */
  votes: StudioVote[]
}

export type TopStudios = {
  /** Studios with at least `gate` entries, best first. */
  studios: StudioScore[]
  gate: number
  /** Ū: the user's W-weighted mean vote utility e^(αZ) over every vote. A title above it lifts its studio. */
  averageUtility: number
  scale: ScoreScale
  /** Scored titles among the titles the user watched (every status but Planning). */
  scoredCount: number
  watchedCount: number
}

export type StudioScoring = { ok: true; topStudios: TopStudios } | { ok: false; reason: 'too-few-scored'; scored: number }

const WATCHING: ReadonlySet<ListStatus> = new Set(['CURRENT', 'PAUSED'])

function scaleOf(scores: readonly number[]): ScoreScale {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((a, s) => a + (s - mean) ** 2, 0) / scores.length
  return { mean, sd: Math.max(Math.sqrt(variance), SD_FLOOR) }
}

/** An entry's z and its runtime weight w (0 when it doesn't count). */
function entryVote(e: StudioTitle, scale: ScoreScale, favourite: boolean): { z: number; w: number; scored: boolean } {
  const dropped = e.status === 'DROPPED'
  const rewatches = Math.max(e.repeat, e.status === 'REPEATING' ? 1 : 0)
  const scored = e.score > 0
  let z: number
  if (scored) {
    z = (e.score - scale.mean) / scale.sd
    if (dropped) z = Math.min(z, DROP_Z_CAP)
  } else {
    z = dropped ? UNSCORED_DROP_Z : rewatches ? UNSCORED_REWATCH_Z : 0
  }
  if (favourite) z += FAV_BONUS

  let episodes = e.episodes || Math.max(e.progress || 1, 1)
  // A drop weighs what was actually watched (at least one episode), not the whole show.
  if (dropped) episodes = Math.min(Math.max(e.progress || 1, 1), episodes)
  let w = Math.log(1 + (episodes * (e.duration || 24)) / 24) * Math.min(1 + 0.5 * rewatches, 2)
  if (WATCHING.has(e.status)) w *= Math.min((e.progress || 0) / episodes, 1)
  if (Math.abs(z) < MID_BAND) w *= MID_WEIGHT
  if (!scored && !favourite) {
    if (dropped) w *= UNSCORED_DROP_WEIGHT
    else if (!rewatches) w = 0
  }
  return { z, w, scored }
}

/** Ranks the user's studios by Studio Score v2.7 (without the love count, the step-down gate and labels: #90). */
export function scoreStudios(list: readonly StudioTitle[], favouriteIds: Iterable<number>): StudioScoring {
  const watched = list.filter((e) => e.status !== 'PLANNING')
  const scores = watched.filter((e) => e.score > 0).map((e) => e.score)
  if (scores.length < MIN_SCORED) return { ok: false, reason: 'too-few-scored', scored: scores.length }
  const scale = scaleOf(scores)
  const favourites = new Set(favouriteIds)

  // Every entry is its own vote at each of its main studios (sequels, films and recaps included).
  const byStudio = new Map<number, { name: string; votes: Array<{ title: StudioTitle; z: number; w: number; scored: boolean; favourite: boolean }> }>()
  for (const title of watched) {
    const favourite = favourites.has(title.mediaId)
    const { z, w, scored } = entryVote(title, scale, favourite)
    if (w <= 0) continue
    for (const studio of title.studios) {
      let group = byStudio.get(studio.id)
      if (!group) byStudio.set(studio.id, (group = { name: studio.name, votes: [] }))
      group.votes.push({ title, z, w, scored, favourite })
    }
  }

  // W = √w, rescaled so the mean W over every vote is 1: k then reads as "k entry votes".
  const rootWeights = [...byStudio.values()].flatMap((g) => g.votes.map((v) => Math.sqrt(v.w)))
  const rescale = rootWeights.length / rootWeights.reduce((a, b) => a + b, 0)
  const studios = [...byStudio].map(([id, group]) => ({
    id,
    name: group.name,
    votes: group.votes.map(({ title, z, w, scored, favourite }): StudioVote => ({
      title,
      z,
      weight: Math.sqrt(w) * rescale,
      favourite,
      scored,
    })),
  }))

  const allVotes = studios.flatMap((s) => s.votes)
  const averageUtility =
    allVotes.reduce((a, v) => a + v.weight * Math.exp(ALPHA * v.z), 0) / allVotes.reduce((a, v) => a + v.weight, 0)
  const base = Math.log(averageUtility) / ALPHA

  const scored = studios
    .map((s) => ({ ...s, score: entropicMean(s.votes, K, averageUtility) - base }))
    .sort((a, b) => b.score - a.score)

  return {
    ok: true,
    topStudios: {
      studios: scored.filter((s) => s.votes.length >= GATE),
      gate: GATE,
      averageUtility,
      scale,
      scoredCount: scores.length,
      watchedCount: watched.length,
    },
  }
}

/** The user's mean and spread on the 10-point scale; a vote's z is how far a score sits from the mean. */
export type ScoreScale = { mean: number; sd: number }

/** What one vote at this score is worth on the user's scale: e^(αz). Average studio ≈ the user's average of these. */
export function points(score: number, scale: ScoreScale): number {
  return Math.exp(ALPHA * ((score - scale.mean) / scale.sd))
}

/**
 * The first term of S: the entropic (log-sum-exp) mean of the votes' z, with `k` pseudo-votes of utility `prior`
 * (= e^(αZ) of the prior).
 */
export function entropicMean(votes: ReadonlyArray<{ z: number; weight: number }>, k = 0, prior = 1): number {
  let num = k * prior
  let den = k
  for (const v of votes) {
    num += v.weight * Math.exp(ALPHA * v.z)
    den += v.weight
  }
  return Math.log(num / den) / ALPHA
}
