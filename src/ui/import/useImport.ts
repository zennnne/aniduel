import { useRef, useState } from 'react'
import type { AniListGateway } from '../../anilist/gateway.ts'
import type { MediaType, TitleLanguage, Viewer } from '../../anilist/types.ts'
import { planHash, resumeImport } from '../../import/plan.ts'
import { importOf, importSummary, newImport, type ImportState } from '../../import/importState.ts'
import {
  deleteTickOverrides,
  loadScoringSettings,
  loadTickOverrides,
  loadWriteQueue,
  saveTickOverrides,
  saveWriteQueue,
  type RankingKey,
} from '../../persistence/progress.ts'
import { replay, type DuelLog, type LogEvent, type RankingState } from '../../ranking/engine.ts'
import { importPlan, previewOpen, previewRows, type PendingWrite, type TickOverrides } from '../../ranking/preview.ts'
import { score, scoringFor, type ScoringSettings } from '../../ranking/scoring.ts'
import { SCORE_FORMAT_LABEL } from '../preview/scoreFormat.ts'
import type { Notice } from '../Shell.tsx'
import { isStatusWrite, type RunnerStatus, type WriteQueue } from '../../writes/writeQueue.ts'
import type { ImportStage } from './ImportScreen.tsx'

/** The Import screen: the plan with each write's status, what the write queue is doing, and which step is showing. */
export type ImportView = { stage: ImportStage; state: ImportState; status: RunnerStatus | null; writtenBefore: number | null }

/** What the Import needs from the app around it. Read fresh on every render, like any props. */
export type ImportDeps = {
  storage: Storage
  gateway: AniListGateway | null
  /** The user's write queue: the Import's scores are written in line with Catch-up's statuses. */
  queue: WriteQueue | null
  viewer: Viewer | null
  setViewer: (viewer: Viewer) => void
  /** The open Ranking's user and Media Type; null before login. */
  key: RankingKey | null
  latestLog: () => DuelLog | null
  /**
   * Appends to the open Ranking's Duel log and saves it (its scoring settings, ADR 0007), returning the new state.
   * Null without a log.
   */
  append: (...events: LogEvent[]) => RankingState | null
  /** Old AniList score (100-point) of every Pool title, or null while the list is loading. */
  oldScores: ReadonlyMap<number, number> | null
  /** A title's name as Preview shows it in this title language; on Scores it orders the titles on one level (ADR 0007). */
  name: (id: number, language: TitleLanguage) => string
  /** Resume ran its fresh `Viewer` check and put the settings in the log: Preview may open again (ADR 0003). */
  onViewerChecked: () => void
  setNotice: (notice: Notice) => void
  /** Whether the Import screen is showing, and how to go to a screen. */
  onImportScreen: boolean
  goTo: (screen: 'import' | 'preview' | 'ranking') => void
  onGatewayError: (error: unknown) => void
  /** Scores AniList has now for titles this Import wrote, so Preview shows them. */
  onWritten: (key: RankingKey, written: ReadonlyMap<number, number>) => void
}

const MEDIA_TYPES: readonly MediaType[] = ['ANIME', 'MANGA']

/** A saved Import that still has titles to write or retry. */
function unfinished(state: ImportState | null): ImportState | null {
  if (!state) return null
  const { left, failed } = importSummary(state)
  return left + failed > 0 ? state : null
}

/**
 * Import (#10): the ticks chosen on Preview, the plan and its confirmation, the write queue writing it, and resuming an
 * Import that was cut off. Ticks and the Import's progress are saved per user and Media Type.
 */
export function useImport(deps: ImportDeps) {
  const [view, setView] = useState<ImportView | null>(null)
  // An Import saved in this browser that was cut off or has failures; offered as "Resume" in a banner.
  const [saved, setSaved] = useState<ImportState | null>(null)
  // Import ticks the user changed on Preview (the default is "ticked if the score changes"), saved (#1 US52).
  const [ticks, setTicks] = useState<TickOverrides>(new Map())
  // Stops watching the Import being written, if any.
  const watching = useRef<(() => void) | null>(null)

  /** Stops the Import being written, if any. Its progress is already saved; the queue no longer touches the screen. */
  function detach() {
    watching.current?.()
    watching.current = null
  }

  /** Loads what is saved for another Ranking (login, Media Type switch, Restore, Start over). */
  function open(key: RankingKey) {
    detach()
    // As before the queue was shared: an Import being written stops, to be resumed from its banner.
    for (const mediaType of MEDIA_TYPES) deps.queue?.holdImport(mediaType)
    setView(null)
    const queued = deps.queue?.snapshot().state ?? loadWriteQueue(deps.storage, key.userId)
    setSaved(unfinished(queued && importOf(queued, key.mediaType)))
    setTicks(loadTickOverrides(deps.storage, key))
  }

  /** Logout: nothing of this user stays on screen. */
  function close() {
    detach()
    setView(null)
    setSaved(null)
    setTicks(new Map())
  }

  /** Takes the Media Type's Import out of the write queue (or out of what is saved, before the queue is up). */
  function dropImport(key: RankingKey) {
    if (deps.queue) {
      deps.queue.dropImport(key.mediaType)
      return
    }
    const queued = loadWriteQueue(deps.storage, key.userId)
    if (!queued) return
    const writes = queued.writes.filter((w) => isStatusWrite(w) || w.mediaType !== key.mediaType)
    const imports = queued.imports.filter((i) => i.mediaType !== key.mediaType)
    saveWriteQueue(deps.storage, key.userId, writes.length > 0 ? { imports, writes } : null)
  }

  /** Start over: the saved Import and ticks belong to the Ranking that is thrown away. */
  function discard(key: RankingKey) {
    dropImport(key)
    deleteTickOverrides(deps.storage, key)
  }

  /** Scores planned in an old Score Format can't be written (ADR 0003). */
  function dropForFormatChange(key: RankingKey) {
    dropImport(key)
    setSaved(null)
  }

  function tick(id: number, ticked: boolean) {
    const next = new Map(ticks).set(id, ticked)
    if (deps.key) saveTickOverrides(deps.storage, deps.key, next)
    setTicks(next)
  }

  /**
   * The Import plan for the current Ranking, as Preview would make it; empty unless Preview could be open (the Ranking
   * is finished, or only Refine Duels are left: then its settled titles).
   */
  function currentPlan(state: RankingState, viewer: Viewer, settings: ScoringSettings): PendingWrite[] {
    if (!previewOpen(state.prompt) || !deps.oldScores) return []
    const format = viewer.scoreFormat
    const name = (id: number) => deps.name(id, viewer.titleLanguage)
    return importPlan(previewRows(state, score(state, format, settings), deps.oldScores, format, name), ticks)
  }

  /** Preview's Import button: the plan is shown for confirmation; nothing is written yet. */
  function plan(writes: PendingWrite[], settings: ScoringSettings) {
    const log = deps.latestLog()
    if (!deps.viewer || !log) return
    const format = deps.viewer.scoreFormat
    const hash = planHash(log, { format, settings }, ticks)
    setView({ stage: 'confirm', state: newImport(writes, { hash, format }), status: null, writtenBefore: null })
    deps.goTo('import')
  }

  /**
   * Puts the plan in the write queue and shows it being written; the queue saves every write's status, so a cut-off
   * Import can resume. The Import ends when nothing of it is left to write, when it is stopped, or when the queue stops.
   */
  function write(state: ImportState) {
    const { queue, key } = deps
    if (!queue || !key) return
    detach()
    setSaved(null)
    setView({ stage: 'running', state, status: null, writtenBefore: null })
    const unsubscribe = queue.subscribe((snapshot) => {
      const current = importOf(snapshot.state, key.mediaType)
      if (!current) return finish(state) // dropped meanwhile
      setView((v) => v && { ...v, state: current, status: snapshot.status ?? v.status })
      const stopped = !snapshot.released.includes(key.mediaType) || !snapshot.running
      if (importSummary(current).left === 0 || stopped) finish(current)
    })
    watching.current = unsubscribe

    function finish(final: ImportState) {
      if (watching.current !== unsubscribe) return // another Media Type, a logout or a newer Import took over
      detach()
      const { left, failed } = importSummary(final)
      if (left + failed === 0) queue?.dropImport(key!.mediaType)
      setSaved(unfinished(final))
      setView((v) => v && { ...v, state: final, stage: left > 0 ? 'stopped' : 'done' })
      deps.onWritten(key!, new Map(final.writes.filter((w) => w.status === 'done').map((w) => [w.mediaId, w.scoreRaw])))
    }

    queue.writeImport(key.mediaType, state)
  }

  /**
   * Resumes a saved Import (or retries its failures). Runs `Viewer` again first: a changed Score Format drops the plan
   * (ADR 0003); a changed Duel log, scoring settings or ticks means a recalculated plan, confirmed again.
   */
  function resume(savedState: ImportState) {
    const { gateway, viewer } = deps
    if (!gateway || !viewer) return
    gateway.viewer().then((fresh) => {
      deps.setViewer(fresh)
      const before = deps.latestLog()
      if (!before || !deps.key) return
      const key = { userId: fresh.id, mediaType: deps.key.mediaType }
      // The settings go into the log first (ADR 0007), so Preview and the plan read the same ones from it.
      const replayed = replay(before)
      const { settings, event } = scoringFor(replayed, loadScoringSettings(deps.storage, key), fresh.scoreFormat)
      const state = (event && deps.append(event)) || replayed
      const log = deps.latestLog() ?? before
      deps.onViewerChecked()
      const decision = resumeImport(savedState, {
        hash: planHash(log, { format: fresh.scoreFormat, settings }, ticks),
        format: fresh.scoreFormat,
        plan: () => currentPlan(state, fresh, settings),
      })
      const drop = (message: string) => {
        dropImport(key)
        setSaved(null)
        setView(null)
        deps.setNotice({ tone: 'info', message })
        if (deps.onImportScreen) deps.goTo(previewOpen(state.prompt) ? 'preview' : 'ranking')
      }
      switch (decision.kind) {
        case 'dropped':
          drop(`Your Score Format changed to ${SCORE_FORMAT_LABEL[fresh.scoreFormat]}, so the unfinished Import was dropped. Check the scores on Preview and import again.`)
          return
        case 'continue':
          if (!deps.onImportScreen) deps.goTo('import')
          write(decision.state)
          return
        case 'confirm-again':
          if (decision.state.writes.length === 0) {
            drop(
              previewOpen(state.prompt)
                ? 'Your Ranking changed since the last Import, and no score is left to write.'
                : 'Your Ranking changed since the last Import and is not finished, so the unfinished Import was dropped.',
            )
            return
          }
          setView({ stage: 'confirm', state: decision.state, status: null, writtenBefore: decision.writtenBefore })
          if (!deps.onImportScreen) deps.goTo('import')
      }
    }, deps.onGatewayError)
  }

  /** "Your last Import didn't finish" with Resume (once the list is loaded), unless the Import screen is showing. */
  function notice(canResume: boolean): Notice | null {
    if (!saved || !deps.viewer || deps.onImportScreen) return null
    const { left, failed, total } = importSummary(saved)
    return {
      tone: 'info',
      message: `Your last Import didn't finish: ${left + failed} of ${total} scores still to write.`,
      action: canResume ? { label: 'Resume Import', onClick: () => resume(saved) } : undefined,
    }
  }

  return {
    view,
    ticks,
    tick,
    open,
    close,
    discard,
    dropForFormatChange,
    plan,
    write,
    resume,
    /** The Stop button: no more of the Import is written (a write already sent still lands); Resume carries on. */
    stop: () => deps.key && deps.queue?.holdImport(deps.key.mediaType),
    notice,
  }
}
