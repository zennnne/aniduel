// The way into a Keep My Scale Ranking (#80), from opening the Picker to the Ranking ending with its Import: the
// Pick again question before the Picker (#66), the Picker's Confirm, the Replace dialog over a saved Scores /
// Full Ranking Ranking (#46, #64), and the end (ADR 0010). The Ranking's lifecycle does the starting, replacing and
// ending; this decides which of them a step calls and holds what the steps hand to each other. It never changes
// screens, dialogs, toasts or banners itself: it tells the app around it, which does.
import type { ListEntry, MediaType, Viewer } from '../../anilist/types.ts'
import type { DuelLogStore } from '../../persistence/duelLogStore.ts'
import type { RankingKey } from '../../persistence/progress.ts'
import type { RankingLifecycle, StartFailure } from '../../persistence/rankingLifecycle.ts'
import { createUnsettledStore } from '../../persistence/unsettledTitles.ts'
import type { PickerStart, PickerWayIn } from './pickerView.ts'

/** The dialogs the flow asks through. */
export type KeepMyScaleDialog = 'pick-again' | 'replace-with-keep-my-scale'

export type KeepMyScaleFlowSnapshot = {
  /** How the Picker was last opened, which decides its starting picks (#64); the picks themselves live in the Picker. */
  wayIn: PickerWayIn
  /** The remembered unsettled titles the user chose to pick again on the way in (#66); empty when they said no. */
  pickAgain: readonly number[]
}

/** What the flow needs from the app around it. Read whenever it is needed, so it is always the latest. */
export type KeepMyScaleFlowDeps = {
  storage: Storage
  viewer: Viewer | null
  /** The selected Media Type: the one a Ranking is started or replaced under. */
  mediaType: MediaType
  /** The user's lists as read so far. */
  lists: Partial<Record<MediaType, readonly ListEntry[]>>
  /** The open Ranking's Duel log: a saved Ranking is one Confirm asks before replacing. */
  duelLog: Pick<DuelLogStore, 'latest'>
  lifecycle: Pick<RankingLifecycle, 'startKeepMyScale' | 'replaceWithKeepMyScale' | 'endKeepMyScale'>
  /** Opens one of the flow's dialogs, or with null closes the one that is open. */
  showDialog: (dialog: KeepMyScaleDialog | null) => void
  /** The Picker is to show. */
  onPicker: () => void
  /** A Keep My Scale Ranking was started where none was saved: on to its Duels. */
  onStarted: () => void
  /** A Keep My Scale Ranking was saved over the Scores / Full Ranking Ranking under the key: on to its Duels. */
  onReplaced: (key: RankingKey) => void
  /** The Ranking was not started, or not replaced: nothing changed. */
  onNotStarted: (failure: StartFailure) => void
  /** An Import ended the open Keep My Scale Ranking. */
  onEnded: () => void
  /** The browser refused to save the titles the ended Ranking left unsettled; the Ranking ended anyway. */
  onSaveRefused: () => void
}

export type KeepMyScaleFlow = {
  snapshot(): KeepMyScaleFlowSnapshot
  /** Called on every change; returns an unsubscribe. */
  subscribe(listener: (snapshot: KeepMyScaleFlowSnapshot) => void): () => void
  /**
   * Opens the Picker (#64); it starts from the picks for how it was opened. When the last Keep My Scale Ranking left
   * titles unsettled that the Picker can show, the user is first asked whether to pick them again (#66). `type` is
   * the Media Type the Picker opens for, when the app is switching to it in the same click; the selected one otherwise.
   */
  openPicker(wayIn: PickerWayIn, type?: MediaType): void
  /** Opens the Picker, with the remembered titles to tick on top of the way in's own (#66). */
  enterPicker(remembered: readonly number[]): void
  /**
   * The Picker's Confirm (#64): starts the Keep My Scale Ranking on the picks, or first asks to replace a saved
   * Scores / Full Ranking Ranking (#46).
   */
  confirm(picks: PickerStart): void
  /**
   * Runs only after the user confirmed in the Replace dialog (#46): a Keep My Scale Ranking on the titles picked in
   * the Picker is saved over the saved Scores / Full Ranking Ranking. If the browser refuses, that one is still saved
   * and open.
   */
  replace(): void
  /** Cancel in the Replace dialog: the picks held for it are let go. */
  cancelReplace(): void
  /**
   * An Import wrote every score it planned: a Keep My Scale Ranking ends with it (ADR 0010). Of it only the titles
   * left unsettled are kept, without their answers, for the next Picker to offer (ADR 0011, #66). Does nothing for an
   * Import of any other Ranking, so it can be called for every finished Import.
   */
  end(key: RankingKey): void
}

const NOTHING: KeepMyScaleFlowSnapshot = { wayIn: { from: 'start' }, pickAgain: [] }

export function createKeepMyScaleFlow(deps: () => KeepMyScaleFlowDeps): KeepMyScaleFlow {
  let state = NOTHING
  /** What the Picker's Confirm would start, held while the Replace dialog asks about the saved Ranking. */
  let pickedStart: PickerStart | null = null
  const listeners = new Set<(snapshot: KeepMyScaleFlowSnapshot) => void>()

  function set(change: Partial<KeepMyScaleFlowSnapshot>) {
    state = { ...state, ...change }
    for (const listener of [...listeners]) listener(state)
  }

  /** The user, and the key a Ranking is started or replaced under: theirs and the selected Media Type's. Null before login. */
  function rankingOfViewer(): { viewer: Viewer; rankingKey: RankingKey } | null {
    const { viewer, mediaType } = deps()
    return viewer && { viewer, rankingKey: { userId: viewer.id, mediaType } }
  }

  function enterPicker(remembered: readonly number[]) {
    set({ pickAgain: remembered })
    deps().showDialog(null)
    deps().onPicker()
  }

  /**
   * Keep My Scale (ADR 0009, ADR 0011): the Picker's Anchor snapshot (every scored title but the picks) goes into a
   * new log now, naming the split rule chosen in the Picker (ADR 0013); Duels start straight away.
   */
  function start(picks: PickerStart) {
    const login = rankingOfViewer()
    if (!login) return
    const started = deps().lifecycle.startKeepMyScale(login.rankingKey, login.viewer.scoreFormat, picks)
    if (!started.ok) return deps().onNotStarted(started)
    deps().onStarted()
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    openPicker(wayIn, type) {
      const { storage, viewer, mediaType, lists, showDialog } = deps()
      set({ wayIn })
      const openedFor = type ?? mediaType
      const remembered = viewer ? createUnsettledStore(storage, { userId: viewer.id, mediaType: openedFor }).titles(lists[openedFor] ?? []) : []
      if (remembered.length > 0) return showDialog('pick-again')
      enterPicker([])
    },
    enterPicker,
    confirm(picks) {
      if (deps().duelLog.latest()) {
        pickedStart = picks
        deps().showDialog('replace-with-keep-my-scale')
        return
      }
      start(picks)
    },
    replace() {
      const login = rankingOfViewer()
      const picks = pickedStart
      if (!login || !picks) return
      deps().showDialog(null)
      pickedStart = null
      const replaced = deps().lifecycle.replaceWithKeepMyScale(login.rankingKey, login.viewer.scoreFormat, picks)
      if (!replaced.ok) return deps().onNotStarted(replaced)
      deps().onReplaced(login.rankingKey)
    },
    cancelReplace() {
      deps().showDialog(null)
      pickedStart = null
    },
    end(key) {
      const end = deps().lifecycle.endKeepMyScale(key)
      if (!end.ended) return
      if (end.unsettled === 'lost') deps().onSaveRefused()
      deps().onEnded()
    },
  }
}
