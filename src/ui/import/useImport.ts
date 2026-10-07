import { useRef, useState } from 'react'
import type { AniListGateway } from '../../anilist/gateway.ts'
import type { TitleLanguage, Viewer } from '../../anilist/types.ts'
import { planHash, resumeImport } from '../../import/plan.ts'
import { browserClock, importSummary, newImport, runImport, type ImportState, type RunnerStatus } from '../../import/runner.ts'
import {
  deleteImportState,
  deleteTickOverrides,
  loadImportState,
  loadScoringSettings,
  loadTickOverrides,
  saveImportState,
  saveTickOverrides,
  type RankingKey,
} from '../../persistence/progress.ts'
import { replay, type DuelLog, type LogEvent, type RankingState } from '../../ranking/engine.ts'
import { importPlan, previewOpen, previewRows, type PendingWrite, type TickOverrides } from '../../ranking/preview.ts'
import { score, scoringFor, type ScoringSettings } from '../../ranking/scoring.ts'
import { SCORE_FORMAT_LABEL } from '../preview/scoreFormat.ts'
import type { Notice } from '../Shell.tsx'
import type { ImportStage } from './ImportScreen.tsx'

/** The Import screen: the plan with each write's status, what the Runner is doing, and which step is showing. */
export type ImportView = { stage: ImportStage; state: ImportState; status: RunnerStatus | null; writtenBefore: number | null }

/** What the Import needs from the app around it. Read fresh on every render, like any props. */
export type ImportDeps = {
  storage: Storage
  gateway: AniListGateway | null
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

/** A saved Import that still has titles to write or retry. */
function unfinished(state: ImportState | null): ImportState | null {
  if (!state) return null
  const { left, failed } = importSummary(state)
  return left + failed > 0 ? state : null
}

/**
 * Import (#10): the ticks chosen on Preview, the plan and its confirmation, the Runner writing it, and resuming an
 * Import that was cut off. Ticks and the Import's progress are saved per user and Media Type.
 */
export function useImport(deps: ImportDeps) {
  const [view, setView] = useState<ImportView | null>(null)
  // An Import saved in this browser that was cut off or has failures; offered as "Resume" in a banner.
  const [saved, setSaved] = useState<ImportState | null>(null)
  // Import ticks the user changed on Preview (the default is "ticked if the score changes"), saved (#1 US52).
  const [ticks, setTicks] = useState<TickOverrides>(new Map())
  const running = useRef<AbortController | null>(null)

  /** Ends the running Import, if any. Its progress is already saved; the run's ending no longer touches the screen. */
  function detach() {
    running.current?.abort()
    running.current = null
  }

  /** Loads what is saved for another Ranking (login, Media Type switch, Restore, Start over). */
  function open(key: RankingKey) {
    detach()
    setView(null)
    setSaved(unfinished(loadImportState(deps.storage, key)))
    setTicks(loadTickOverrides(deps.storage, key))
  }

  /** Logout: nothing of this user stays on screen. */
  function close() {
    detach()
    setView(null)
    setSaved(null)
    setTicks(new Map())
  }

  /** Start over: the saved Import and ticks belong to the Ranking that is thrown away. */
  function discard(key: RankingKey) {
    deleteImportState(deps.storage, key)
    deleteTickOverrides(deps.storage, key)
  }

  /** Scores planned in an old Score Format can't be written (ADR 0003). */
  function dropForFormatChange(key: RankingKey) {
    deleteImportState(deps.storage, key)
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

  /** Saves the plan and writes it; every write's status is saved as it happens, so a cut-off Import can resume. */
  async function write(state: ImportState) {
    const { gateway, key, storage } = deps
    if (!gateway || !key) return
    detach()
    const stop = new AbortController()
    running.current = stop
    saveImportState(storage, key, state)
    setSaved(null)
    setView({ stage: 'running', state, status: null, writtenBefore: null })
    const show = (next: ImportState, status: RunnerStatus | null) => {
      if (running.current === stop) setView((v) => v && { ...v, state: next, status: status ?? v.status })
    }
    let final = state
    try {
      final = await runImport(
        {
          gateway,
          clock: browserClock,
          userId: key.userId,
          mediaType: key.mediaType,
          save: (s) => {
            final = s
            saveImportState(storage, key, s)
            show(s, null)
          },
        },
        state,
        { signal: stop.signal, onStatus: (status, s) => show(s, status) },
      )
    } catch (e) {
      deps.onGatewayError(e)
    }
    if (running.current !== stop) return // another Media Type, a logout or a newer run took over
    running.current = null
    const { left, failed } = importSummary(final)
    if (left + failed === 0) deleteImportState(storage, key)
    setSaved(unfinished(final))
    setView((v) => v && { ...v, state: final, stage: left > 0 ? 'stopped' : 'done' })
    deps.onWritten(key, new Map(final.writes.filter((w) => w.status === 'done').map((w) => [w.mediaId, w.scoreRaw])))
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
        deleteImportState(deps.storage, key)
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
          void write(decision.state)
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
    /** The Stop button: the run ends after the current write; its ending still updates the screen. */
    stop: () => running.current?.abort(),
    notice,
  }
}
