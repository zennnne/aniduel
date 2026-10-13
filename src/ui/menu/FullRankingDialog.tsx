import { Dialog } from '../Dialog.tsx'
import { count } from '../meta.ts'

/** Before switching Scores to Full Ranking (#25, #28): about how many more Duels it takes. No answer is lost. */
export function FullRankingDialog(props: { extraDuels: number; finerSteps: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      title="Switch to Full Ranking?"
      onCancel={props.onCancel}
      actions={
        <button className="go" onClick={props.onConfirm}>
          Switch
        </button>
      }
    >
      <p>
        Every title gets its own place, so titles on the same score get ordered too
        {props.finerSteps ? ', and you can pick 0.5 or 0.1 steps.' : '. The scores come out the same as on Scores; only the order is extra.'}
      </p>
      <p>
        That takes about <b>+{count(props.extraDuels, 'Duel')}</b>. Every answer you already gave still counts.
      </p>
      <p className="small">You can switch back to Scores at any time.</p>
    </Dialog>
  )
}
