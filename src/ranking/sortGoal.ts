// Switching the Sort Goal (ADR 0007, #28): pure, the events to append. Every earlier answer is kept: the engine
// carries on from the Tiers and insertion bounds it already has, so no Duel is asked again.
import type { ScoreFormat } from '../anilist/types.ts'
import type { LogEvent, RankingState, SortGoal } from './engine.ts'
import { scoringFor, withStep, type SavedScoring, type ScoreStep } from './scoring.ts'

/** The Score Step a Ranking gets on each Sort Goal: Scores always uses whole points; Full Ranking starts on human. */
const STEP_FOR: Record<SortGoal, ScoreStep> = { scores: 'whole', 'full-ranking': 'human' }

/** Below this many titles a full sort costs few enough Duels that a new Ranking defaults to Full Ranking. */
const FULL_RANKING_BELOW = 100

/**
 * The Sort Goal a new Ranking defaults to on Start, from its Pool size (ADR 0007, V3 amendment): Full Ranking below
 * 100 titles, Scores from 100 up. Never Score New Titles.
 */
export function defaultSortGoal(poolSize: number): SortGoal {
  return poolSize < FULL_RANKING_BELOW ? 'full-ranking' : 'scores'
}

/** The Sort Goal a Ranking is on. A log without any `sort-goal-set` (an older one) is on Full Ranking. */
export function goalOf(ranking: Pick<RankingState, 'sortGoal'>): SortGoal {
  return ranking.sortGoal ?? 'full-ranking'
}

/**
 * Whether a Ranking is on the Scores Sort Goal: the one question every caller asks. A replayed Ranking on Scores
 * always has its `scoring` and `standing` too.
 */
export function isScores(ranking: Pick<RankingState, 'sortGoal'>): boolean {
  return goalOf(ranking) === 'scores'
}

/**
 * The events that switch a Ranking to `goal`, with the Score Format AniList reports now (none if it is already
 * there). Its scoring settings (the log's own, or for an older log the saved ones, converted if the Score Format
 * changed) move to the new goal's Score Step, best and worst snapped to the nearest levels on it. The order is the
 * engine's: Scores needs whole-step settings before it starts, and Full Ranking must start before a finer step.
 */
export function switchGoalEvents(ranking: RankingState, saved: SavedScoring | null, format: ScoreFormat, goal: SortGoal): LogEvent[] {
  if (goalOf(ranking) === goal) return []
  const { settings } = scoringFor(ranking, saved, format)
  const scoring: LogEvent = { type: 'scoring-set', format, settings: withStep(settings, format, STEP_FOR[goal]) }
  const setGoal: LogEvent = { type: 'sort-goal-set', goal }
  return goal === 'scores' ? [scoring, setGoal] : [setGoal, scoring]
}
