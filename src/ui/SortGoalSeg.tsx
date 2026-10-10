import type { SortGoal } from '../ranking/engine.ts'

const GOALS: readonly { goal: SortGoal; label: string }[] = [
  { goal: 'scores', label: 'Scores' },
  { goal: 'full-ranking', label: 'Full Ranking' },
]

/**
 * Start's third button, Score New Titles (ADR 0009): `count` titles have no score (the badge, null while unknown);
 * `enabled` false shows it disabled with a lock (not eligible, or a Ranking on another Sort Goal is saved).
 */
export type NewTitlesButton = { count: number | null; enabled: boolean }

/**
 * The Sort Goal `seg` [Scores | Full Ranking] (#25), on Start and in Preview's settings bar. On Start it also has
 * [New Titles] (`newTitles`). `locked`: the shown goal can't be left (a saved Score New Titles Ranking), so every other
 * button is disabled.
 */
export function SortGoalSeg(props: { goal: SortGoal; onGoal: (goal: SortGoal) => void; newTitles?: NewTitlesButton; locked?: boolean }) {
  const { goal: current, onGoal, newTitles, locked = false } = props
  const button = (goal: SortGoal, label: string, enabled = true, badge: number | null = null) => (
    <button
      key={goal}
      role="radio"
      aria-checked={current === goal}
      className={current === goal ? 'on' : ''}
      disabled={current !== goal && (locked || !enabled)}
      onClick={() => current !== goal && onGoal(goal)}
    >
      {!enabled && current !== goal && '🔒 '}
      {label}
      {badge !== null && <span className="badge">{badge}</span>}
    </button>
  )
  return (
    <div className={newTitles ? 'seg tight' : 'seg'} role="radiogroup" aria-label="Sort Goal">
      {GOALS.map(({ goal, label }) => button(goal, label))}
      {newTitles && button('score-new-titles', 'New Titles', newTitles.enabled, newTitles.count)}
    </div>
  )
}
