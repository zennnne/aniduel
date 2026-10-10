import { useRef, useState } from 'react'
import type { MediaType } from '../../anilist/types.ts'
import type { SortGoal } from '../../ranking/engine.ts'
import { BackupError, readBackup, type Backup } from '../../persistence/backup.ts'
import { Dialog } from '../Dialog.tsx'
import { MEDIA_LABEL, SORT_GOAL_LABEL, count } from '../meta.ts'

/**
 * Restore from Backup: drop or choose a file; it is checked straight away and the Restore button only
 * replaces the progress in this browser once the file fits this user and Media Type.
 */
export function RestoreDialog(props: {
  userId: number
  userName: string
  mediaType: MediaType
  /** True when this browser already has progress for this Media Type that Restore will replace. */
  replacesProgress: boolean
  onRestore: (backup: Backup) => void
  onCancel: () => void
}) {
  const [backup, setBackup] = useState<Backup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const media = MEDIA_LABEL[props.mediaType]

  async function check(file: File | undefined) {
    if (!file) return
    setBackup(null)
    setError(null)
    try {
      setBackup(readBackup(await file.text(), { userId: props.userId, mediaType: props.mediaType }))
    } catch (e) {
      setError(e instanceof BackupError ? e.message : 'This file could not be read.')
    }
  }

  return (
    <Dialog
      title="Restore from Backup"
      onCancel={props.onCancel}
      actions={
        <button
          className={props.replacesProgress ? 'go danger' : 'go'}
          disabled={!backup}
          onClick={() => backup && props.onRestore(backup)}
        >
          {props.replacesProgress ? 'Replace and restore' : 'Restore'}
        </button>
      }
    >
      <div
        className={over ? 'drop over' : 'drop'}
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void check(e.dataTransfer.files[0])
        }}
      >
        Drop a Backup file here, or <u>choose a file</u>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void check(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      <p className="small">
        The file must be for <b>{props.userName}</b> and <b>{media}</b>. Restoring replaces the progress in this browser.
      </p>
      {error && (
        <p className="small warn err" role="alert">
          {error}
        </p>
      )}
      {backup && (
        <p className="small strong">
          Backup from {formatSavedAt(backup.savedAt)} · {backup.log.events.length} events.
          {props.replacesProgress && ` Your current ${media} progress in this browser will be replaced.`}
        </p>
      )}
    </Dialog>
  )
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'an unknown date' : date.toLocaleString()
}

/** Start this Ranking over: a red confirm that says what is thrown away. */
export function StartOverDialog(props: {
  mediaType: MediaType
  /** What the saved Ranking holds; null when it can't be read (it is thrown away all the same). */
  counts: { roughSort: number; duels: number } | null
  onConfirm: () => void
  onSaveBackup?: () => void
  onCancel: () => void
}) {
  const media = MEDIA_LABEL[props.mediaType]
  const { counts } = props
  return (
    <Dialog
      title={`Start ${media} over?`}
      onCancel={props.onCancel}
      actions={
        <button className="go danger" onClick={props.onConfirm}>
          Start over
        </button>
      }
    >
      <p>
        {counts ? (
          <>
            All {count(counts.roughSort, 'Rough Sort choice')} and <b>{count(counts.duels, 'Duel')}</b> for {media} are
            thrown away.
          </>
        ) : (
          <>The saved {media} progress in this browser is thrown away.</>
        )}{' '}
        Your AniList scores are not touched.
      </p>
      <p className="small">
        Tip: save a Backup first if you might want this Ranking back.
        {props.onSaveBackup && (
          <>
            {' '}
            <button className="link small" onClick={props.onSaveBackup}>
              Save Backup now
            </button>
          </>
        )}
      </p>
    </Dialog>
  )
}

/**
 * Score New Titles picked on Start while a Scores / Full Ranking Ranking is saved (#46): there is one Ranking per
 * Media Type, so starting it throws the saved one away. A red confirm, with the Backup one tap away.
 */
export function ReplaceWithNewTitlesDialog(props: {
  mediaType: MediaType
  /** The saved Ranking's Sort Goal and Duels; null when it can't be read (it is thrown away all the same). */
  saved: { goal: SortGoal; duels: number } | null
  onConfirm: () => void
  onSaveBackup?: () => void
  onCancel: () => void
}) {
  const media = MEDIA_LABEL[props.mediaType]
  const { saved } = props
  return (
    <Dialog
      title="Replace your saved Ranking?"
      onCancel={props.onCancel}
      actions={
        <>
          {props.onSaveBackup && (
            <button className="go" onClick={props.onSaveBackup}>
              Save Backup file
            </button>
          )}
          <button className="go danger" onClick={props.onConfirm}>
            Replace and start
          </button>
        </>
      }
    >
      <p>
        Score New Titles starts a new {media} Ranking. Your saved{' '}
        {saved ? (
          <>
            <b>{SORT_GOAL_LABEL[saved.goal]}</b> Ranking and its <b>{count(saved.duels, 'Duel')}</b> are
          </>
        ) : (
          <>{media} progress in this browser is</>
        )}{' '}
        thrown away. Your AniList scores are not touched.
      </p>
      <p className="small">Save a Backup first if you might want that Ranking back.</p>
    </Dialog>
  )
}
