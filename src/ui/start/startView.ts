// Start's view of one Media Type's list: the Pool a Ranking has or would start on, its Sort Goal, Keep My Scale's
// Anchors and eligibility, and every number Start shows. Pure; App adds the handlers.
import type { ListEntry, ListStatus, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import type { AnimeStanding } from '../../catchup/exitOffer.ts'
import { anchorsOf, estimateKeepMyScaleDuels, keepMyScaleEligibility, keepMyScalePool, type KeepMyScaleEligibility } from '../../pool/anchors.ts'
import { buildPool, estimateDuels, roughSortOrder, type Pool } from '../../pool/pool.ts'
import { keepMyScaleInLog } from '../../pool/sync.ts'
import { KEEP_MY_SCALE, type AnchorScore, type SortGoal } from '../../ranking/engine.ts'
import { duelsFromBands, fullRankingExtra } from '../../ranking/estimate.ts'
import { planFromScores, type ScoresPlan } from '../../ranking/fromScores.ts'
import { defaultSettings } from '../../ranking/scoring.ts'
import { defaultSortGoal, goalOf, isKeepMyScale } from '../../ranking/sortGoal.ts'
import type { ReplayedLog } from '../useDuelLog.ts'
import type { PoolForm } from './StartScreen.tsx'

export type StartInput = {
  /** The Media Type's list, fetched for every offered status; null while it is loading. */
  list: readonly ListEntry[] | null
  statuses: readonly ListStatus[]
  scoreFormat: ScoreFormat
  titleLanguage: TitleLanguage
  /** The Ranking saved for this Media Type, replayed; null without one (or with one that can't be used). */
  saved: ReplayedLog | null
  /** Saved progress exists but can't be used: nothing new can start over it. */
  savedBroken: boolean
  /** The Sort Goal picked on Start for a new Ranking (#28); null while it follows the Pool size (#38). */
  picked: SortGoal | null
}

/** What `PoolForm` shows, without its handlers. */
export type StartFormData = Required<
  Pick<PoolForm, 'statuses' | 'pool' | 'saved' | 'scoresPlan' | 'bandDuels' | 'goal' | 'poolDuels' | 'extraDuels' | 'keepMyScale'>
>

export type StartView = {
  /** The saved Ranking's Pool, or the one a new Ranking would start on; null while the list is loading. */
  pool: Pool | null
  /** Old AniList score (100-point) of every Pool title; null while the list is loading. */
  oldScores: ReadonlyMap<number, number> | null
  /** Keep My Scale (ADR 0009): the Anchors a new Ranking would snapshot, and whether there are enough of them. */
  anchors: AnchorScore[] | null
  eligibility: KeepMyScaleEligibility | null
  /** The Ranking is a Keep My Scale one, or a new one would be. */
  onKeepMyScale: boolean
  /** The Sort Goal a new Ranking starts on: the pick, else the default for the Pool size (ADR 0007, V3 amendment). */
  newGoal: SortGoal
  /** A new Ranking's Rough Sort order; null while the list is loading or progress is saved. */
  startOrder: number[] | null
  /** The Rough Sort from Scores plan over `startOrder` (ADR 0008). */
  scoresPlan: ScoresPlan | null
  /** The Ranking saved in this browser: none, a Keep My Scale one, one on another Sort Goal, or one that can't be used. */
  savedRanking: 'none' | 'keep-my-scale' | 'other' | 'broken'
  form: StartFormData
}

export function startView(input: StartInput): StartView {
  const { list, statuses, scoreFormat, titleLanguage, saved, savedBroken, picked } = input
  const ranking = saved?.ranking ?? null
  const anchors = list ? anchorsOf(list, scoreFormat) : null
  const eligibility = anchors ? keepMyScaleEligibility(anchors) : null
  // A Keep My Scale pick on Start stops counting once it isn't eligible (e.g. on another Media Type).
  const keepMyScalePicked = picked === KEEP_MY_SCALE && eligibility?.eligible !== false
  const savedKeepMyScale = saved ? keepMyScaleInLog(saved.log) : null
  const onKeepMyScale = ranking ? isKeepMyScale(ranking) : keepMyScalePicked
  // The Pool's estimate is for Scores with the Score Format's defaults (ADR 0007); Full Ranking's is worked out below.
  const scale = { format: scoreFormat, settings: defaultSettings(scoreFormat, 'whole') }
  // Keep My Scale's Pool is the titles without a score (and the saved Ranking's picked titles), never an Anchor.
  const pool = !list ? null : onKeepMyScale ? keepMyScalePool(list, statuses, savedKeepMyScale, scale) : buildPool(list, statuses, scale)
  const newGoal = (picked === KEEP_MY_SCALE && !keepMyScalePicked ? null : picked) ?? defaultSortGoal(pool?.titles.length ?? 0)
  const oldScores = pool && new Map(pool.titles.map((e) => [e.mediaId, e.oldScore100]))
  const startOrder = pool && !saved && !savedBroken ? roughSortOrder(pool.titles, titleLanguage) : null
  const scoresPlan = startOrder && planFromScores(startOrder.map((id) => ({ id, score100: oldScores?.get(id) ?? 0 })))

  const goal = ranking ? goalOf(ranking) : newGoal
  const fullPoolDuels = pool ? estimateDuels(pool.titles.length) : null
  // Keep My Scale: one search per picked title over the Anchor scores (a saved Ranking: its unsettled titles only).
  const keepMyScaleDuels = ranking?.keepMyScale
    ? estimateKeepMyScaleDuels(ranking.progress.ranked.total - ranking.progress.ranked.done, ranking.keepMyScale.levels.length)
    : pool && eligibility
      ? estimateKeepMyScaleDuels(pool.titles.length, eligibility.scores)
      : null
  // With a Scores / Full Ranking Ranking saved, Keep My Scale stays clickable: it asks to replace that Ranking (#46).
  const keepMyScaleReason = eligibility && !eligibility.eligible ? eligibility.reason : null

  return {
    pool,
    oldScores,
    anchors,
    eligibility,
    onKeepMyScale,
    newGoal,
    startOrder,
    scoresPlan,
    savedRanking: savedBroken ? 'broken' : !saved ? 'none' : savedKeepMyScale ? 'keep-my-scale' : 'other',
    form: {
      statuses,
      pool,
      // A Keep My Scale Ranking has no Rough Sort: its progress is the picked titles that have a score.
      saved: (ranking?.keepMyScale ? ranking.progress.ranked : ranking?.progress.roughSort) ?? null,
      scoresPlan,
      bandDuels: ranking && !onKeepMyScale ? duelsFromBands(ranking) : null,
      goal,
      poolDuels: onKeepMyScale ? keepMyScaleDuels : pool && goal === 'scores' ? pool.expectedDuels : fullPoolDuels,
      extraDuels:
        ranking && !onKeepMyScale
          ? fullRankingExtra(ranking) || null
          : pool && fullPoolDuels !== null && !onKeepMyScale
            ? fullPoolDuels - pool.expectedDuels
            : null,
      keepMyScale: {
        // The titles without a score in the chosen statuses (Keep My Scale's own Pool).
        count: list ? keepMyScalePool(list, statuses, savedKeepMyScale).titles.length : null,
        enabled: keepMyScaleReason === null && Boolean(eligibility),
        reason: onKeepMyScale ? null : keepMyScaleReason,
        anchors: ranking?.keepMyScale?.anchorCount ?? eligibility?.anchors ?? 0,
      },
    },
  }
}

/**
 * Where the user's anime stands for Catch-up's exit offer (#52), read off Start's view of the anime list so the two
 * can't disagree. Null while the list isn't read or its saved progress can't be used.
 */
export function animeStanding(anime: StartView): AnimeStanding | null {
  const unscored = anime.form.keepMyScale.count
  if (!anime.eligibility || unscored === null || anime.savedRanking === 'broken') return null
  return { eligibleForKeepMyScale: anime.eligibility.eligible, unscored, saved: anime.savedRanking }
}
