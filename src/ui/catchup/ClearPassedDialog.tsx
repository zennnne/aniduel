import { Dialog } from '../Dialog.tsx'
import { count } from '../meta.ts'

/** Clear Catch-up's Passed list (#50): the hidden titles may be suggested again from the next batch. */
export function ClearPassedDialog(props: { hidden: number; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      title="Clear Catch-up’s Passed list?"
      onCancel={props.onCancel}
      actions={
        <button className="go" onClick={props.onConfirm}>
          Clear
        </button>
      }
    >
      <p>
        <b>{count(props.hidden, 'title')}</b> you left unmarked can come back from the next batch. Nothing on AniList
        changes.
      </p>
    </Dialog>
  )
}
