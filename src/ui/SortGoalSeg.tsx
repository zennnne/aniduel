import type { SortGoal } from '../ranking/engine.ts'

const GOALS: readonly { goal: SortGoal; label: string }[] = [
  { goal: 'scores', label: 'Scores' },
  { goal: 'full-ranking', label: 'Full Ranking' },
]

/** The Sort Goal `seg` [Scores | Full Ranking] (#25), on Start and in Preview's settings bar. */
export function SortGoalSeg(props: { goal: SortGoal; onGoal: (goal: SortGoal) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Sort Goal">
      {GOALS.map(({ goal, label }) => (
        <button
          key={goal}
          role="radio"
          aria-checked={props.goal === goal}
          className={props.goal === goal ? 'on' : ''}
          onClick={() => props.goal !== goal && props.onGoal(goal)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
