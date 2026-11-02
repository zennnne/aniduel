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
/** γ: weight of the love count, ln(1 + n_love), which rewards the number of loved works. */
const GAMMA = 0.1
/** A vote counts as loved from about this z (≈ 8+ on the owner's scale)... */
const LOVE_Z = 0.9
/** ...with this soft edge, σ((Z − LOVE_Z) / LOVE_SOFT), so there is no cliff at LOVE_Z. */
const LOVE_SOFT = 0.15
/** Entries a studio needs to be ranked. */
export const GATE = 6
/** A short list lowers the gate one entry at a time until this many studios rank... */
const GATE_TARGET = 10
/** ...but never below this. */
const GATE_FLOOR = 4
/** How many studios below the gate the watchlist shows. */
const WATCHLIST_SIZE = 5
/** A vote is a hit from this z, a flop up to this one. */
const HIT_Z = 1.2
const FLOP_Z = -1
/** Labels compare a studio's rates with the pooled rates of this many top ranked studios... */
const LABEL_POOL = 20
/** ...and a rate counts as high only this far above the pool, so one title doesn't flip a label. */
const LABEL_MARGIN = 0.06

/** How a studio treats the user: hits often or not, flops often or not. */
export type StudioLabel = 'elite' | 'bold' | 'reliable' | 'meh'

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
  /** Share of its votes at z ≥ 1.2. */
  hitRate: number
  /** Share of its votes at z ≤ −1. */
  flopRate: number
  /** 💎 Elite (hit rate high, flop rate low), 🎲 Bold (both high), 🛡️ Reliable (both low), 💤 Meh (hit low, flop high). */
  label: StudioLabel
}

export type TopStudios = {
  /** Studios with at least `gate` entries, best first. */
  studios: StudioScore[]
  /** The best studios below the gate, best first: promising, but too little seen to rank. */
  watchlist: StudioScore[]
  /** Entries a studio needed to be ranked: `GATE`, or lower for a short list. */
  gate: number
  /** The hit and flop rates a studio must pass to read high: the pooled rates of the top ranked studios + the margin. */
  labelLines: { hit: number; flop: number }
  /** Ū: the user's W-weighted mean vote utility e^(αZ) over every vote. A title above it lifts its studio. */
  averageUtility: number
  scale: ScoreScale
  /** Scored titles among the titles the user watched (every status but Planning). */
  scoredCount: number
  watchedCount: number
  /** Titles that count (a score, or an unscored drop, rewatch or favourite), with or without a main studio. */
  countedCount: number
  /** Scored titles among those: under half of `countedCount`, the labels may be off (#91's note). */
  countedScoredCount: number
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

/** Ranks the user's studios by Studio Score v2.7. */
export function scoreStudios(list: readonly StudioTitle[], favouriteIds: Iterable<number>): StudioScoring {
  const watched = list.filter((e) => e.status !== 'PLANNING')
  const scores = watched.filter((e) => e.score > 0).map((e) => e.score)
  if (scores.length < MIN_SCORED) return { ok: false, reason: 'too-few-scored', scored: scores.length }
  const scale = scaleOf(scores)
  const favourites = new Set(favouriteIds)

  // Every entry is its own vote at each of its main studios (sequels, films and recaps included).
  const byStudio = new Map<number, { name: string; votes: Array<{ title: StudioTitle; z: number; w: number; scored: boolean; favourite: boolean }> }>()
  let countedCount = 0
  let countedScoredCount = 0
  for (const title of watched) {
    const favourite = favourites.has(title.mediaId)
    const entry = entryVote(title, scale, favourite)
    const { w, scored } = entry
    if (w <= 0) continue
    // A vote's Z is the entropic mean of its entries (one per vote since v2.5), as the prototype computes it:
    // ln(w·e^z / w) is z up to rounding, and that rounding decides whether an unscored drop (z −1) is a flop,
    // so it is kept for parity with the prototype's labels (#90).
    const z = entropicMean([{ z: entry.z, weight: w }])
    countedCount++
    if (scored) countedScoredCount++
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
    .map((s) => ({
      ...s,
      score: entropicMean(s.votes, K, averageUtility) - base + GAMMA * Math.log(1 + loveCount(s.votes)),
      hitRate: s.votes.filter((v) => v.z >= HIT_Z).length / s.votes.length,
      flopRate: s.votes.filter((v) => v.z <= FLOP_Z).length / s.votes.length,
    }))
    .sort((a, b) => b.score - a.score)

  let gate = GATE
  while (gate > GATE_FLOOR && scored.filter((s) => s.votes.length >= gate).length < GATE_TARGET) gate--
  const ranked = scored.filter((s) => s.votes.length >= gate)
  const watchlist = scored.filter((s) => s.votes.length < gate).slice(0, WATCHLIST_SIZE)

  // The label baseline: hit and flop rates pooled over the top ranked studios' votes (none ranked: 0).
  const pool = ranked.slice(0, LABEL_POOL)
  const pooled = (rate: (s: (typeof pool)[number]) => number) => {
    const votes = pool.reduce((a, s) => a + s.votes.length, 0)
    return votes ? pool.reduce((a, s) => a + rate(s) * s.votes.length, 0) / votes : 0
  }
  const hitLine = pooled((s) => s.hitRate) + LABEL_MARGIN
  const flopLine = pooled((s) => s.flopRate) + LABEL_MARGIN
  const labelled = (s: (typeof scored)[number]): StudioScore => ({ ...s, label: labelOf(s.hitRate > hitLine, s.flopRate > flopLine) })

  return {
    ok: true,
    topStudios: {
      studios: ranked.map(labelled),
      watchlist: watchlist.map(labelled),
      gate,
      labelLines: { hit: hitLine, flop: flopLine },
      averageUtility,
      scale,
      scoredCount: scores.length,
      watchedCount: watched.length,
      countedCount,
      countedScoredCount,
    },
  }
}

/**
 * n_love: a soft count of the studio's loved works, not entries. Its titles joined by SEQUEL/PREQUEL form one
 * franchise, worth at most 1 (its best vote). Fav split: in a franchise with two or more favourites, each favourite
 * counts on its own and the rest stays one.
 */
function loveCount(votes: readonly StudioVote[]): number {
  const index = new Map(votes.map((v, i) => [v.title.mediaId, i]))
  const parent = votes.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  votes.forEach((v, i) => {
    for (const relation of v.title.relations) {
      const j = index.get(relation.mediaId)
      if (j !== undefined) parent[root(i)] = root(j)
    }
  })
  const favouritesIn = new Map<number, number>()
  votes.forEach((v, i) => {
    if (v.favourite) favouritesIn.set(root(i), (favouritesIn.get(root(i)) ?? 0) + 1)
  })
  const best = new Map<string, number>()
  votes.forEach((v, i) => {
    const franchise = root(i)
    const key = v.favourite && (favouritesIn.get(franchise) ?? 0) >= 2 ? `fav ${i}` : `franchise ${franchise}`
    best.set(key, Math.max(best.get(key) ?? 0, sigmoid((v.z - LOVE_Z) / LOVE_SOFT)))
  })
  return [...best.values()].reduce((a, b) => a + b, 0)
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

function labelOf(hitsHigh: boolean, flopsHigh: boolean): StudioLabel {
  if (hitsHigh) return flopsHigh ? 'bold' : 'elite'
  return flopsHigh ? 'meh' : 'reliable'
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
