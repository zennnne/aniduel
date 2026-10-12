import { Dialog } from '../Dialog.tsx'
import { count } from '../meta.ts'

/**
 * Asked before the Picker opens (#66, ADR 0011) when the last Keep My Scale Ranking ended with titles left unsettled.
 * Either answer opens the Picker: Yes ticks them, No opens it as it otherwise would and keeps them for next time.
 */
export function PickAgainDialog(props: { left: number; onPickAgain: () => void; onSkip: () => void; onCancel: () => void }) {
  return (
    <Dialog
      title="Pick the unsettled titles again?"
      onCancel={props.onCancel}
      actions={
        <>
          <button className="go" onClick={props.onSkip}>
            Not now
          </button>
          <button className="go" onClick={props.onPickAgain}>
            Pick them again
          </button>
        </>
      }
    >
      <p>
        Your last Keep My Scale Ranking ended with <b>{count(props.left, 'title')}</b> not yet settled. Pick them again
        to have them ticked in the Picker; your answers to their Duels are not kept.
      </p>
    </Dialog>
  )
}
