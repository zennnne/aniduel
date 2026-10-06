// Switching the Sort Goal (ADR 0007, #28): pure, the events to append. Every earlier answer is kept: the engine
// carries on from the Tiers and insertion bounds it already has, so no Duel is asked again.
import type { ScoreFormat } from '../anilist/types.ts'
import type { LogEvent, RankingState, SortGoal } from './engine.ts'
import { scoringFor, withStep, type SavedScoring, type ScoreStep } from './scoring.ts'

/** The Score Step a Ranking gets on each Sort Goal: Scores always uses whole points; Full Ranking starts on human. */
const STEP_FOR: Record<SortGoal, ScoreStep> = { scores: 'whole', 'full-ranking': 'human' }

/** The Sort Goal a Ranking is on. A log without any `sort-goal-set` (an older one) is on Full Ranking. */
export function goalOf(ranking: Pick<RankingState, 'sortGoal'>): SortGoal {
  return ranking.sortGoal ?? 'full-ranking'
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
