// Preview and Import (#10, #56), from opening Preview to a finished Import: the fresh `Viewer` check (ADR 0003), the
// ticks chosen on Preview, the Import plan and its confirmation, the write queue writing it, and Stop, Resume and Retry.
// It reports its own state and never changes screens: the app around it decides which screen shows.
import type { AniListGateway } from '../anilist/gateway.ts'
import type { MediaType, ScoreFormat, TitleLanguage, Viewer } from '../anilist/types.ts'
import {
  deleteTickOverrides,
  loadScoringSettings,
  loadTickOverrides,
  loadWriteQueue,
  saveTickOverrides,
  saveWriteQueue,
  type RankingKey,
} from '../persistence/progress.ts'
import { replay, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'
import { previewOpen, readPreview, type PendingWrite, type TickOverrides } from '../ranking/preview.ts'
import { scoringFor, type ScoringSettings } from '../ranking/scoring.ts'
import { isStatusWrite, type RunnerStatus, type WriteQueue } from '../writes/writeQueue.ts'
import { importOf, importSummary, newImport, retryFailed, type ImportState } from './importState.ts'
import { planHash, resumeImport } from './plan.ts'

export type ImportStage = 'confirm' | 'running' | 'stopped' | 'done'

/** An Import as the Import screen shows it: the plan with each write's status, what the write queue is doing, and which step it is at. */
export type ImportView = { stage: ImportStage; state: ImportState; status: RunnerStatus | null; writtenBefore: number | null }

/**
 * A saved Import that was dropped instead of resumed: the Score Format changed (ADR 0003), the Ranking changed and no
 * score is left to write, or it changed and is no longer finished. `format` is the Score Format AniList reports now;
 * `previewOpen` is whether Preview can be open on the Ranking.
 */
export type DroppedImport = {
  stage: 'dropped'
  reason: 'format-changed' | 'nothing-left' | 'ranking-unfinished'
  format: ScoreFormat
  previewOpen: boolean
}

export type ImportProgress = ImportView | DroppedImport

/** What the fresh `Viewer` check found: the Score Format now, and whether the scoring settings had to be converted to it. */
export type PreviewCheck = { format: ScoreFormat; converted: boolean }

export type PreviewImportSnapshot = {
  /** `openPreview` is running its `Viewer` check. */
  openingPreview: boolean
  /** The fresh `Viewer` check of this Ranking session (ADR 0003); Preview may be open only once there is one. */
  preview: PreviewCheck | null
  /** Import ticks the user changed on Preview (the default is "ticked if the score changes"), saved (#1 US52). */
  ticks: TickOverrides
  /** The Import: waiting for confirmation, being written, stopped, done or dropped. Null when there is none. */
  importing: ImportProgress | null
  /** An Import saved in this browser that was cut off or has failures, to offer for Resume. */
  unfinished: ImportState | null
}

/** What Preview and Import need from the app around them. Read whenever it is needed, so it is always the latest. */
export type PreviewImportDeps = {
  storage: Storage
  gateway: AniListGateway | null
  /** The user's write queue: the Import's scores are written in line with Catch-up's statuses. */
  queue: WriteQueue | null
  viewer: Viewer | null
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
  /** The `Viewer` as AniList reports it now. */
  onViewer: (fresh: Viewer) => void
  onGatewayError: (error: unknown) => void
  /** Scores AniList has now for titles this Import wrote, so Preview shows them. */
  onWritten: (key: RankingKey, written: ReadonlyMap<number, number>) => void
  /** The Import wrote every score it planned, with none failed: a Keep My Scale Ranking ends here (ADR 0010). */
  onFinished: (key: RankingKey) => void
}

export type PreviewImport = {
  snapshot(): PreviewImportSnapshot
  /** Called on every change; returns an unsubscribe. */
  subscribe(listener: (snapshot: PreviewImportSnapshot) => void): () => void
  /** Loads what is saved for another Ranking (login, Media Type switch, Restore, Start over). */
  open(key: RankingKey): void
  /** Logout: nothing of this user stays. */
  close(): void
  /** The Ranking is thrown away (Start over, a finished Keep My Scale Import): so are its saved Import and ticks. */
  discard(key: RankingKey): void
  /**
   * Runs `Viewer` again first (spec Auth, ADR 0003): if the Score Format changed since best / worst were chosen, they
   * are converted to the new format, the conversion is appended to the Duel log (ADR 0007), and a saved Import is
   * dropped. An older log without settings of its own gets them appended too, so Preview reads them from the log.
   * Resolves to the check once Preview may open, or null if it may not.
   */
  openPreview(): Promise<PreviewCheck | null>
  tick(id: number, ticked: boolean): void
  /** Preview's Import button: the plan is shown for confirmation; nothing is written yet. False if there is none to show. */
  planImport(): boolean
  /**
   * Puts the confirmed plan in the write queue and shows it being written; the queue saves every write's status, so a
   * cut-off Import can resume. The Import ends when nothing of it is left to write, when it is stopped, or when the
   * queue stops.
   */
  confirm(): void
  /** The Stop button: no more of the Import is written (a write already sent still lands); Resume carries on. */
  stop(): void
  /**
   * Resumes the unfinished Import. Runs `Viewer` again first: a changed Score Format drops the plan (ADR 0003); a
   * changed Duel log, scoring settings or ticks means a recalculated plan, confirmed again. Resolves to where the
   * Import is then, or null if nothing was resumed.
   */
  resume(): Promise<ImportProgress | null>
  /** Resume, with every failed title back in line. */
  retry(): Promise<ImportProgress | null>
}

const MEDIA_TYPES: readonly MediaType[] = ['ANIME', 'MANGA']

const NOTHING: PreviewImportSnapshot = { openingPreview: false, preview: null, ticks: new Map(), importing: null, unfinished: null }

/** A saved Import that still has titles to write or retry. */
function unfinished(state: ImportState | null): ImportState | null {
  if (!state) return null
  const { left, failed } = importSummary(state)
  return left + failed > 0 ? state : null
}

/** Ticks and the Import's progress are saved per user and Media Type. */
export function createPreviewImport(deps: () => PreviewImportDeps): PreviewImport {
  let state = NOTHING
  /** The open Ranking's user and Media Type; null before login. */
  let key: RankingKey | null = null
  /** Counts the Rankings opened and closed, so a `Viewer` answer for an earlier one changes nothing. */
  let session = 0
  // Stops watching the Import being written, if any.
  let watching: (() => void) | null = null
  const listeners = new Set<(snapshot: PreviewImportSnapshot) => void>()

  function set(change: Partial<PreviewImportSnapshot>) {
    state = { ...state, ...change }
    for (const listener of [...listeners]) listener(state)
  }

  /** Stops the Import being written, if any, reaching the screen. Its progress is already saved. */
  function detach() {
    watching?.()
    watching = null
  }

  /** Takes the Media Type's Import out of the write queue (or out of what is saved, before the queue is up). */
  function dropImport(from: RankingKey) {
    const { queue, storage } = deps()
    if (queue) {
      queue.dropImport(from.mediaType)
      return
    }
    const queued = loadWriteQueue(storage, from.userId)
    if (!queued) return
    const writes = queued.writes.filter((w) => isStatusWrite(w) || w.mediaType !== from.mediaType)
    const imports = queued.imports.filter((i) => i.mediaType !== from.mediaType)
    saveWriteQueue(storage, from.userId, writes.length > 0 ? { imports, writes } : null)
  }

  /**
   * The fresh `Viewer` check (ADR 0003) before Preview and before a resumed Import: the scoring settings for the Score
   * Format AniList reports now go into the Duel log first (ADR 0007), so Preview and the plan read the same ones from
   * it. Null if AniList couldn't be asked, or the answer came for a Ranking that is no longer open.
   */
  async function checkViewer() {
    const { gateway, viewer } = deps()
    if (!gateway || !viewer || !key) return null
    const asked = session
    let fresh: Viewer
    try {
      fresh = await gateway.viewer()
    } catch (e) {
      deps().onGatewayError(e)
      return null
    }
    if (asked !== session || !key) return null
    deps().onViewer(fresh)
    const before = deps().latestLog()
    if (!before) return null
    const checkedKey: RankingKey = { userId: fresh.id, mediaType: key.mediaType }
    const replayed = replay(before)
    const format = fresh.scoreFormat
    const { settings, converted, event } = scoringFor(replayed, loadScoringSettings(deps().storage, checkedKey), format)
    const ranking = (event && deps().append(event)) || replayed
    return { fresh, key: checkedKey, log: deps().latestLog() ?? before, ranking, settings, check: { format, converted } }
  }

  /**
   * The Import plan for a Ranking, as Preview would make it; empty unless Preview could be open (the Ranking is
   * finished, or only Refine Duels are left: then its settled titles).
   */
  function planOf(ranking: RankingState, viewer: Viewer, settings: ScoringSettings): PendingWrite[] {
    const { oldScores, name } = deps()
    if (!previewOpen(ranking.prompt) || !oldScores) return []
    return readPreview(ranking, viewer.scoreFormat, settings, oldScores, (id) => name(id, viewer.titleLanguage), state.ticks).plan
  }

  function write(plan: ImportState): ImportProgress | null {
    const { queue } = deps()
    const writing = key
    if (!queue || !writing) return null
    detach()
    set({ unfinished: null, importing: { stage: 'running', state: plan, status: null, writtenBefore: null } })
    /** The Import on screen with what the queue reports of it. */
    const show = (change: Partial<ImportView>) => {
      const view = state.importing
      if (view && view.stage !== 'dropped') set({ importing: { ...view, ...change } })
    }
    const unsubscribe = queue.subscribe((snapshot) => {
      const current = importOf(snapshot.state, writing.mediaType)
      if (!current) return finish(plan) // dropped meanwhile
      show({ state: current, ...(snapshot.status && { status: snapshot.status }) })
      const stopped = !snapshot.released.includes(writing.mediaType) || !snapshot.running
      if (importSummary(current).left === 0 || stopped) finish(current)
    })
    watching = unsubscribe

    function finish(final: ImportState) {
      if (watching !== unsubscribe) return // another Media Type, a logout or a newer Import took over
      detach()
      const { left, failed } = importSummary(final)
      if (left + failed === 0) queue?.dropImport(writing!.mediaType)
      set({ unfinished: unfinished(final) })
      show({ state: final, stage: left > 0 ? 'stopped' : 'done' })
      deps().onWritten(writing!, new Map(final.writes.filter((w) => w.status === 'done').map((w) => [w.mediaId, w.scoreRaw])))
      if (left + failed === 0) deps().onFinished(writing!)
    }

    queue.writeImport(writing.mediaType, plan)
    return state.importing
  }

  async function resumeFrom(saved: ImportState): Promise<ImportProgress | null> {
    const checked = await checkViewer()
    if (!checked) return null
    const { fresh, ranking, settings, check } = checked
    const format = fresh.scoreFormat
    const decision = resumeImport(saved, {
      hash: planHash(checked.log, { format, settings }, state.ticks),
      format,
      plan: () => planOf(ranking, fresh, settings),
    })
    const drop = (reason: DroppedImport['reason']): DroppedImport => {
      dropImport(checked.key)
      const dropped: DroppedImport = { stage: 'dropped', reason, format, previewOpen: previewOpen(ranking.prompt) }
      set({ preview: check, unfinished: null, importing: dropped })
      return dropped
    }
    switch (decision.kind) {
      case 'dropped':
        return drop('format-changed')
      case 'continue':
        set({ preview: check })
        return write(decision.state)
      case 'confirm-again': {
        if (decision.state.writes.length === 0) return drop(previewOpen(ranking.prompt) ? 'nothing-left' : 'ranking-unfinished')
        const confirm: ImportView = { stage: 'confirm', state: decision.state, status: null, writtenBefore: decision.writtenBefore }
        set({ preview: check, importing: confirm })
        return confirm
      }
    }
  }

  /** The Import to resume: the one on screen if it stopped or has failures, otherwise the one saved. */
  function resumable(): ImportState | null {
    const view = state.importing
    const shown = view && (view.stage === 'stopped' || view.stage === 'done') ? unfinished(view.state) : null
    return shown ?? state.unfinished
  }

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open(next) {
      detach()
      const { queue, storage } = deps()
      // As before the queue was shared: an Import being written stops, to be resumed from its banner.
      for (const mediaType of MEDIA_TYPES) queue?.holdImport(mediaType)
      session++
      key = next
      const queued = queue?.snapshot().state ?? loadWriteQueue(storage, next.userId)
      set({ ...NOTHING, unfinished: unfinished(queued && importOf(queued, next.mediaType)), ticks: loadTickOverrides(storage, next) })
    },
    close() {
      detach()
      session++
      key = null
      set(NOTHING)
    },
    discard(gone) {
      dropImport(gone)
      deleteTickOverrides(deps().storage, gone)
      set({ ticks: new Map(), preview: null })
    },
    async openPreview() {
      if (state.openingPreview) return null
      const asked = session
      set({ openingPreview: true })
      try {
        const checked = await checkViewer()
        if (!checked) return null
        // Scores planned in an old Score Format can't be written (ADR 0003).
        if (checked.check.converted) {
          dropImport(checked.key)
          set({ unfinished: null })
        }
        set({ preview: checked.check })
        return checked.check
      } finally {
        if (asked === session) set({ openingPreview: false })
      }
    },
    tick(id, ticked) {
      const next = new Map(state.ticks).set(id, ticked)
      if (key) saveTickOverrides(deps().storage, key, next)
      set({ ticks: next })
    },
    planImport() {
      const { viewer, latestLog } = deps()
      const log = latestLog()
      if (!viewer || !log || !state.preview || state.importing?.stage === 'running') return false
      const ranking = replay(log)
      const format = viewer.scoreFormat
      // Preview shows the log's own settings (ADR 0007), on the Score Format AniList reports.
      if (ranking.scoring?.format !== format) return false
      const { settings } = ranking.scoring
      const hash = planHash(log, { format, settings }, state.ticks)
      const plan = newImport(planOf(ranking, viewer, settings), { hash, format })
      set({ importing: { stage: 'confirm', state: plan, status: null, writtenBefore: null } })
      return true
    },
    confirm() {
      if (state.importing?.stage === 'confirm') write(state.importing.state)
    },
    stop() {
      if (key) deps().queue?.holdImport(key.mediaType)
    },
    async resume() {
      const saved = resumable()
      return saved && resumeFrom(saved)
    },
    async retry() {
      const saved = resumable()
      return saved && resumeFrom(retryFailed(saved))
    },
  }
}
