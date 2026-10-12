// Start's view of one Media Type's list: the Pool a Ranking has or would start on, its Sort Goal, Keep My Scale's
// Anchors and eligibility, and every number Start shows. Pure; App adds the handlers.
import type { ListEntry, ListStatus, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import type { AnimeStanding } from '../../catchup/exitOffer.ts'
import {
  anchorsOf,
  estimateKeepMyScaleDuels,
  keepMyScaleEligibility,
  keepMyScalePool,
  unscoredTitles,
  type KeepMyScaleEligibility,
} from '../../pool/anchors.ts'
import { buildPool, estimateDuels, roughSortOrder, type Pool } from '../../pool/pool.ts'
import { keepMyScaleInLog } from '../../pool/sync.ts'
import { KEEP_MY_SCALE, type AnchorScore, type SortGoal } from '../../ranking/engine.ts'
import { duelsFromBands, fullRankingExtra } from '../../ranking/estimate.ts'
import { planFromScores, type ScoresPlan } from '../../ranking/fromScores.ts'
import { defaultSettings } from '../../ranking/scoring.ts'
import { defaultSortGoal, goalOf } from '../../ranking/sortGoal.ts'
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
  Pick<
    PoolForm,
    'statuses' | 'pool' | 'saved' | 'scoresPlan' | 'bandDuels' | 'goal' | 'poolDuels' | 'extraDuels' | 'keepMyScale' | 'statusChips' | 'mainAction' | 'replacesSaved'
  >
>

export type StartView = {
  /** The saved Ranking's Pool, or the one a new Ranking would start on; null while the list is loading. */
  pool: Pool | null
  /** Old AniList score (100-point) of every Pool title; null while the list is loading. */
  oldScores: ReadonlyMap<number, number> | null
  /** Keep My Scale (ADR 0009): the Anchors a new Ranking would snapshot, and whether there are enough of them. */
  anchors: AnchorScore[] | null
  eligibility: KeepMyScaleEligibility | null
  /** The saved Ranking is a Keep My Scale one, or Keep My Scale is selected for a new one (the Picker comes next). */
  onKeepMyScale: boolean
  /** The Sort Goal a new Ranking starts on: the pick, else the default for the Pool size (ADR 0007, V3 amendment). */
  newGoal: SortGoal
  /** A new Ranking's Rough Sort order; null while the list is loading, progress is saved, or under Keep My Scale (the Picker gives its own). */
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
  // Choosing Keep My Scale only selects it (#64): even over a saved Scores or Full Ranking Ranking, which the Picker's
  // Confirm offers to replace. A saved Keep My Scale Ranking can't switch Sort Goal.
  const onKeepMyScale = savedKeepMyScale ? true : keepMyScalePicked
  const choosingTitles = onKeepMyScale && !savedKeepMyScale
  // The Pool's estimate is for Scores with the Score Format's defaults (ADR 0007); Full Ranking's is worked out below.
  const scale = { format: scoreFormat, settings: defaultSettings(scoreFormat, 'whole') }
  // A saved Keep My Scale Ranking's Pool is the titles picked for it (ADR 0011), so Preview has every old score.
  // A Ranking on another Sort Goal keeps its Pool until the Picker's Confirm replaces it; a new Keep My Scale Ranking
  // has none until the Picker.
  const pool = !list
    ? null
    : savedKeepMyScale
      ? keepMyScalePool(list, savedKeepMyScale, scale)
      : choosingTitles && !ranking
        ? null
        : buildPool(list, statuses, scale)
  const newGoal = (picked === KEEP_MY_SCALE && !keepMyScalePicked ? null : picked) ?? defaultSortGoal(pool?.titles.length ?? 0)
  const oldScores = pool && new Map(pool.titles.map((e) => [e.mediaId, e.oldScore100]))
  const startOrder = pool && !saved && !savedBroken && !onKeepMyScale ? roughSortOrder(pool.titles, titleLanguage) : null
  const scoresPlan = startOrder && planFromScores(startOrder.map((id) => ({ id, score100: oldScores?.get(id) ?? 0 })))

  const goal = savedKeepMyScale || keepMyScalePicked ? KEEP_MY_SCALE : ranking ? goalOf(ranking) : newGoal
  const fullPoolDuels = pool ? estimateDuels(pool.titles.length) : null
  // Keep My Scale: one search per picked title over the Anchor scores (a saved Ranking: its unsettled titles only).
  // Before the Picker there is no estimate: the Picker shows one for the picks.
  const keepMyScaleDuels = ranking?.keepMyScale
    ? estimateKeepMyScaleDuels(ranking.progress.ranked.total - ranking.progress.ranked.done, ranking.keepMyScale.levels.length)
    : null
  // With a Scores / Full Ranking Ranking saved, Keep My Scale stays clickable: the Picker's Confirm asks to replace it (#64).
  const keepMyScaleReason = eligibility && !eligibility.eligible ? eligibility.reason : null
  // The Ranking Start shows: a saved Ranking unless Keep My Scale was chosen over one on another Sort Goal.
  const shownRanking = choosingTitles ? null : ranking

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
      saved: (shownRanking?.keepMyScale ? shownRanking.progress.ranked : shownRanking?.progress.roughSort) ?? null,
      scoresPlan,
      bandDuels: shownRanking && !onKeepMyScale ? duelsFromBands(shownRanking) : null,
      goal,
      poolDuels: onKeepMyScale ? keepMyScaleDuels : pool && goal === 'scores' ? pool.expectedDuels : fullPoolDuels,
      extraDuels:
        onKeepMyScale
          ? null
          : ranking
            ? fullRankingExtra(ranking) || null
            : pool && fullPoolDuels !== null
              ? fullPoolDuels - pool.expectedDuels
              : null,
      keepMyScale: {
        // What Score New Titles used to score: the unscored Completed and Repeating titles (#61).
        count: list ? unscoredTitles(list).length : null,
        enabled: keepMyScaleReason === null && Boolean(eligibility),
        reason: onKeepMyScale ? null : keepMyScaleReason,
        anchors: ranking?.keepMyScale?.anchorCount ?? eligibility?.anchors ?? 0,
      },
      // A Keep My Scale Pool is picked in the Picker, never by list status (ADR 0011).
      statusChips: !onKeepMyScale,
      mainAction: choosingTitles ? 'choose-titles' : saved ? 'continue' : 'start-rough-sort',
      replacesSaved: choosingTitles && Boolean(ranking),
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
