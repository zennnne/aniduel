import { useState } from 'react'

/** Log out (issue #4 App menu): removes the token; an off-by-default checkbox also deletes saved progress. */
export function LogoutDialog(props: { onConfirm: (deleteProgress: boolean) => void; onCancel: () => void }) {
  const [deleteProgress, setDeleteProgress] = useState(false)
  return (
    <div className="dscrim" onClick={props.onCancel}>
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
      >
        <div className="h2" id="logout-title">
          Log out?
        </div>
        <p>Your AniList token is removed from this browser.</p>
        <label className="row chk">
          <input type="checkbox" checked={deleteProgress} onChange={(e) => setDeleteProgress(e.target.checked)} />
          Also delete my saved progress on this browser
        </label>
        {deleteProgress && (
          <p className="small warn">Your Duels on this browser will be gone unless you saved a Backup.</p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="link" onClick={props.onCancel}>
            Cancel
          </button>
          <button className={deleteProgress ? 'go danger' : 'go'} onClick={() => props.onConfirm(deleteProgress)}>
            {deleteProgress ? 'Log out and delete' : 'Log out'}
          </button>
        </div>
      </div>
    </div>
  )
}
