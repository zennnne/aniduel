import { Dialog } from '../Dialog.tsx'
import { count } from '../meta.ts'

/**
 * Asked before the Picker opens (#66, ADR 0011) when the last Keep My Scale Ranking ended with titles left unsettled,
 * from Start and from Catch-up's exit offer alike. A plain dialog with the count and two answers (#63). Either answer
 * opens the Picker: Yes ticks them, No opens it as it otherwise would and keeps them for next time.
 */
export function PickAgainDialog(props: { left: number; onPickAgain: () => void; onSkip: () => void; onCancel: () => void }) {
  return (
    <Dialog
      title="Pick them again?"
      onCancel={props.onCancel}
      noCancelLink
      actions={
        <>
          <button className="go quiet" onClick={props.onSkip}>
            Not now
          </button>
          <button className="go" onClick={props.onPickAgain}>
            Pick them again
          </button>
        </>
      }
    >
      <p>
        {count(props.left, 'title')} {props.left === 1 ? 'was' : 'were'} not settled when your last Keep My Scale Ranking
        ended. Do you want {props.left === 1 ? 'it' : 'them'} picked again?
      </p>
    </Dialog>
  )
}
