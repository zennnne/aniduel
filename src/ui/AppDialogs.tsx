// The app's dialogs, one open at a time. Which one is App's state; this renders it and calls back.
import type { ListEntry, MediaType, Viewer } from '../anilist/types.ts'
import type { Backup } from '../persistence/backup.ts'
import type { UnsettledStore } from '../persistence/unsettledTitles.ts'
import { answeredDuels, type DuelLog, type RankingState } from '../ranking/engine.ts'
import { fullRankingExtra } from '../ranking/estimate.ts'
import { hasHumanStep } from '../ranking/scoring.ts'
import { goalOf } from '../ranking/sortGoal.ts'
import { ClearPassedDialog } from './catchup/ClearPassedDialog.tsx'
import { LogoutDialog } from './LogoutDialog.tsx'
import { ReplaceWithKeepMyScaleDialog, RestoreDialog, StartOverDialog } from './menu/BackupDialogs.tsx'
import { FullRankingDialog } from './menu/FullRankingDialog.tsx'
import { PickAgainDialog } from './picker/PickAgainDialog.tsx'

export type DialogName = 'logout' | 'restore' | 'start-over' | 'full-ranking' | 'clear-passed' | 'replace-with-keep-my-scale' | 'pick-again'

/**
 * Renders the open dialog. `onClose` closes it without doing anything; Log out, Full Ranking and Clear Passed close
 * before their handler runs, the others' handlers close it themselves.
 */
export function AppDialogs(props: {
  dialog: DialogName | null
  onClose: () => void
  viewer: Viewer | null
  mediaType: MediaType
  /** The selected Media Type's list; undefined until it is read. */
  list: readonly ListEntry[] | undefined
  /** The open Ranking and its Duel log; null when none is saved or it can't be used. */
  ranking: RankingState | null
  log: DuelLog | null
  /** Something is saved that a Restore would replace. */
  hasProgress: boolean
  /** Titles Catch-up's Passed list hides now. */
  passedHidden: number
  /** The titles the last Keep My Scale Ranking left unsettled (#66); null before login. */
  unsettledStore: UnsettledStore | null
  onLogout: (deleteProgress: boolean) => void
  onRestore: (backup: Backup) => void
  onFullRanking: () => void
  onClearPassed: () => void
  onReplaceWithKeepMyScale: () => void
  onCancelReplace: () => void
  /** Opens the Picker with these remembered titles ticked. */
  onEnterPicker: (remembered: readonly number[]) => void
  onStartOver: () => void
  onSaveBackup: () => void
}) {
  const { dialog, onClose, viewer, mediaType, list, ranking, log, unsettledStore } = props
  const onSaveBackup = log ? props.onSaveBackup : undefined
  return (
    <>
      {dialog === 'logout' && (
        <LogoutDialog
          onCancel={onClose}
          onConfirm={(deleteProgress) => {
            onClose()
            props.onLogout(deleteProgress)
          }}
        />
      )}
      {dialog === 'restore' && viewer && (
        <RestoreDialog
          userId={viewer.id}
          userName={viewer.name}
          mediaType={mediaType}
          replacesProgress={props.hasProgress}
          onRestore={props.onRestore}
          onCancel={onClose}
        />
      )}
      {dialog === 'full-ranking' && ranking && (
        <FullRankingDialog
          extraDuels={fullRankingExtra(ranking)}
          finerSteps={viewer !== null && hasHumanStep(viewer.scoreFormat)}
          onCancel={onClose}
          onConfirm={() => {
            onClose()
            props.onFullRanking()
          }}
        />
      )}
      {dialog === 'clear-passed' && (
        <ClearPassedDialog
          hidden={props.passedHidden}
          onCancel={onClose}
          onConfirm={() => {
            onClose()
            props.onClearPassed()
          }}
        />
      )}
      {dialog === 'replace-with-keep-my-scale' && viewer && (
        <ReplaceWithKeepMyScaleDialog
          mediaType={mediaType}
          saved={ranking && log ? { goal: goalOf(ranking), duels: answeredDuels(log) } : null}
          onConfirm={props.onReplaceWithKeepMyScale}
          onSaveBackup={onSaveBackup}
          onCancel={props.onCancelReplace}
        />
      )}
      {dialog === 'pick-again' && unsettledStore && (
        <PickAgainDialog
          left={unsettledStore.titles(list ?? []).length}
          onPickAgain={() => props.onEnterPicker(unsettledStore.titles(list ?? []))}
          onSkip={() => props.onEnterPicker([])}
        />
      )}
      {dialog === 'start-over' && viewer && (
        <StartOverDialog
          mediaType={mediaType}
          counts={ranking && log ? { roughSort: ranking.progress.roughSort.done, duels: answeredDuels(log) } : null}
          onConfirm={props.onStartOver}
          onSaveBackup={onSaveBackup}
          onCancel={onClose}
        />
      )}
    </>
  )
}
