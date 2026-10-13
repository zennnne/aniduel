// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { trendingCovers, type AniListSession } from '../anilist/gateway.ts'
import type { Cover, ListEntry, ListStatus, MediaType, Viewer } from '../anilist/types.ts'
import { authorizeUrl } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import { createBackup, restoreBackup, type Backup } from '../persistence/backup.ts'
import type { DuelLogFailure } from '../persistence/duelLogStore.ts'
import type { StartFailure } from '../persistence/rankingLifecycle.ts'
import { createUnsettledStore } from '../persistence/unsettledTitles.ts'
import { browserClock } from '../clock.ts'
import { importSummary } from '../import/importState.ts'
import type { DroppedImport, ImportProgress } from '../import/previewImport.ts'
import {
  loadLastMediaType,
  loadPoolSettings,
  loadScoringSettings,
  saveLastMediaType,
  type RankingKey,
} from '../persistence/progress.ts'
import { DEFAULT_STATUSES } from '../pool/pool.ts'
import { syncEvents } from '../pool/sync.ts'
import {
  KEEP_MY_SCALE,
  withSub,
  type BandIndex,
  type LogEvent,
  type RankingState,
  type SortGoal,
  type SubBandIndex,
  type SwitchableGoal,
} from '../ranking/engine.ts'
import { readPreview } from '../ranking/preview.ts'
import type { ScoringSettings } from '../ranking/scoring.ts'
import { goalOf, isKeepMyScale, switchGoalEvents } from '../ranking/sortGoal.ts'
import { splitOffers } from '../ranking/split.ts'
import { AppDialogs, type DialogName } from './AppDialogs.tsx'
import { BAND_UI } from './bands.ts'
import { createPassedStore } from '../catchup/passed.ts'
import { isNearEmpty, startSign, watchedCount } from '../catchup/entry.ts'
import { isWatched } from '../catchup/watched.ts'
import { exitOffer, type ExitOffer } from '../catchup/exitOffer.ts'
import { useCatchUp } from './catchup/useCatchUp.ts'
import { Kao, SubPill } from './Kao.tsx'
import { AccountMenu, CommandPalette } from './menu/AppMenu.tsx'
import { buildMenuItems } from './menu/buildMenuItems.ts'
import { usePreviewImport } from './import/usePreviewImport.ts'
import { useWriteQueue } from './useWriteQueue.ts'
import { MEDIA_LABEL, count, titleName } from './meta.ts'
import { SCORE_FORMAT_LABEL } from './preview/scoreFormat.ts'
import { RankingSidebar } from './RankingSidebar.tsx'
import {
  NO_RANKING_UI,
  answered,
  boardOpened,
  fixStarted,
  lastCheckLeft,
  leftRanking,
  refineStarted,
  splitSkipped,
  titlesAdded,
  type RankingUi,
  type Transition,
} from './rankingUi.ts'
import { Screens } from './Screens.tsx'
import { Shell, type Notice } from './Shell.tsx'
import { SCREENS, rankingShown, shownScreen, splitBandOf, type Screen } from './shownScreen.ts'
import { useKeepMyScaleFlow } from './picker/useKeepMyScaleFlow.ts'
import { animeStanding, startView, type StartView } from './start/startView.ts'
import { useTheme } from './theme.ts'
import { useAniListSession } from './useAniListSession.ts'
import { useDuelLog } from './useDuelLog.ts'

const TOAST_MS = 4000

/** Tiles in the Start collage. */
const COLLAGE_TILES = 36

function loginRedirect() {
  window.location.assign(authorizeUrl(aniListClientId({ dev: import.meta.env.DEV })))
}

function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

/** Why an unfinished Import was dropped instead of resumed. */
function droppedMessage(dropped: DroppedImport): string {
  switch (dropped.reason) {
    case 'format-changed':
      return `Your Score Format changed to ${SCORE_FORMAT_LABEL[dropped.format]}, so the unfinished Import was dropped. Check the scores on Preview and import again.`
    case 'nothing-left':
      return 'Your Ranking changed since the last Import, and no score is left to write.'
    case 'ranking-unfinished':
      return 'Your Ranking changed since the last Import and is not finished, so the unfinished Import was dropped.'
  }
}

/**
 * `storage`: where the login and all progress are kept, checked before the app renders (#76).
 * `fake`: dev only (#68), a session on a fake AniList in place of the login and the network.
 */
export function App({ storage, fake }: { storage: Storage; fake?: AniListSession }) {
  const { theme, toggleTheme } = useTheme(storage)
  // Covers for Start before login. Left empty on failure: the collage falls back to placeholders.
  const [trending, setTrending] = useState<readonly Cover[]>([])
  const [mediaType, setMediaType] = useState<MediaType>('ANIME')
  const [statuses, setStatuses] = useState<readonly ListStatus[]>(DEFAULT_STATUSES)
  const duelLog = useDuelLog(storage, { seed: newSeed, discardImport })
  const { log, ranking, lifecycle } = duelLog
  // Saved progress that exists but can't be used. Starting over would overwrite it, so Start is blocked.
  const [savedBroken, setSavedBroken] = useState(false)
  const [screen, setScreen] = useState<Screen>('start')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<DialogName | null>(null)
  // What only makes sense for the open Ranking; leaving it, whichever way, resets it all at once.
  const [rankingUi, setRankingUi] = useState(NO_RANKING_UI)
  const { lastCheckContinued, previewFix, previewMoving } = rankingUi
  const patchRankingUi = (change: Partial<RankingUi>) => setRankingUi((s) => ({ ...s, ...change }))
  // A new object per toast, so showing the same message twice restarts its timer.
  const [toast, setToast] = useState<{ message: ReactNode } | null>(null)
  // The Sort Goal the user picked on Start for a new Ranking (#28), or null while they haven't touched it and it
  // follows the Pool size (#38). A saved Ranking's goal lives in its log. Not reset on logout: logging in again loads the page anew.
  const [pickedGoal, setPickedGoal] = useState<SortGoal | null>(null)

  // The login, the Viewer and the lists: the selected Media Type's, and in Catch-up the anime list too, where its exit
  // offer checks the Anchors (#52).
  const aniList = useAniListSession({
    storage,
    fake,
    mediaType,
    animeToo: screen === 'catchup',
    onViewer: openLastRanking,
    onListRead: syncFetched,
    onExpired: loginExpired,
    onUnreachable: aniListUnreachable,
  })
  const { token, gateway, limiter, candidateSource, viewer, lists } = aniList
  const viewerId = viewer?.id ?? null
  // One write queue for Import's scores and Catch-up's statuses.
  const writes = useWriteQueue({
    storage,
    gateway,
    userId: viewerId,
    limiter,
    // Not the Duel log, but the same refusal: the same banner says so, and the queue keeps writing.
    onSaveRefused: () => reportFailure({ reason: 'save-refused' }),
    onError: aniList.failed,
  })
  // The open Ranking's user and Media Type: the key everything saved for it lives under.
  const rankingKey: RankingKey | null = viewer ? { userId: viewer.id, mediaType } : null

  const list = lists[mediaType]
  const viewerFormat = viewer?.scoreFormat
  const titleLanguage = viewer?.titleLanguage
  // The saved Ranking's Pool, or the one a new Ranking would start on, and everything Start shows of it.
  const startInput = useMemo(
    () =>
      viewerFormat && titleLanguage
        ? { list: list ?? null, statuses, scoreFormat: viewerFormat, titleLanguage, saved: log && ranking ? { log, ranking } : null, savedBroken, picked: pickedGoal }
        : null,
    [list, statuses, viewerFormat, titleLanguage, log, ranking, savedBroken, pickedGoal],
  )
  const start = useMemo(() => startInput && startView(startInput), [startInput])
  const pool = start?.pool ?? null
  const oldScores = start?.oldScores ?? null
  const entries = useMemo(() => new Map((list ?? []).map((e) => [e.mediaId, e])), [list])
  // Start's collage: the Pool's covers, the list's until there is a Pool, the trending ones before login.
  const covers = useMemo(() => pool?.titles ?? list?.filter(isWatched) ?? trending, [pool, list, trending])
  // The anime list without its Planning titles, as Catch-up reads it (it reads Planning itself, fresh).
  const watchedAnime = useMemo(() => lists.ANIME?.filter(isWatched) ?? null, [lists.ANIME])

  // The way into a Keep My Scale Ranking, from the Picker to the Import that ends it.
  const keepMyScale = useKeepMyScaleFlow({
    storage,
    viewer,
    mediaType,
    lists,
    duelLog,
    lifecycle,
    showDialog: setDialog,
    onPicker: showPicker,
    onStarted: showKeepMyScaleDuels,
    onReplaced: keepMyScaleReplaced,
    onNotStarted: (failure) => reportFailure(failure, couldNotStart),
    // Not the Duel log, but the same refusal: the same banner says so.
    onSaveRefused: () => reportFailure({ reason: 'save-refused' }),
    onEnded: () => setRankingUi(leftRanking),
  })

  const imports = usePreviewImport({
    storage,
    gateway,
    queue: writes.queue,
    viewer,
    duelLog,
    oldScores,
    name: (id, language) => titleName(entries.get(id), id, language),
    onViewer: aniList.viewerChecked,
    onGatewayError: aniList.failed,
    onDuelLogFailure: (failure) =>
      reportFailure(failure, (why) => `Your Ranking's scoring settings couldn't be brought up to date (${why}). Your progress was left untouched.`),
    onSaveRefused: () => reportFailure({ reason: 'save-refused' }),
    // Preview should show the scores AniList has now.
    onWritten: (key, written) => aniList.scoresWritten(key.mediaType, written),
    onFinished: keepMyScale.end,
  })

  /**
   * The Ranking's lifecycle throws away a Ranking's Import state through here. Declared as a function, read only when
   * a Ranking is replaced, ended or thrown away: `imports` is made after the Duel log it reads.
   */
  function discardImport(key: RankingKey) {
    imports.discard(key)
  }

  // The titles the last Keep My Scale Ranking left unsettled, for this user and Media Type (#66).
  const unsettledStore = useMemo(() => (viewerId === null ? null : createUnsettledStore(storage, { userId: viewerId, mediaType })), [storage, viewerId, mediaType])

  const passedStore = useMemo(() => (viewerId === null ? undefined : createPassedStore(storage, viewerId)), [storage, viewerId])
  const catchUp = useCatchUp({
    storage,
    passedStore,
    gateway,
    animeList: watchedAnime,
    queue: writes.queue,
    source: candidateSource,
    viewer,
    clock: browserClock,
    seed: newSeed,
    onGatewayError: aniList.failed,
    // Titles Catch-up added can join the anime Pool: read the list again, which syncs a saved Ranking.
    onWritten: () => aniList.refresh('ANIME'),
  })

  const needTrending = !token && trending.length === 0
  useEffect(() => {
    if (!needTrending) return
    let cancelled = false
    trendingCovers({ fetch: aniList.fetch }, COLLAGE_TILES)
      .then((covers) => !cancelled && setTrending(covers))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [needTrending, aniList.fetch])

  const showToast = (message: ReactNode) => setToast({ message })
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  /** Every screen change pushes a history entry, so the browser's back button returns to the previous screen. */
  function goTo(next: Screen) {
    window.history.pushState({ screen: next }, '')
    setScreen(next)
  }

  /** What a transition of the open Ranking's screen state decided: its fields that change, then the screen to go to. */
  function apply({ change, goTo: next }: Transition) {
    patchRankingUi(change)
    if (next) goTo(next)
  }

  useEffect(() => {
    window.history.replaceState({ screen: 'start' }, '')
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { screen?: Screen } | null
      setScreen(state?.screen && SCREENS.includes(state.screen) ? state.screen : 'start')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /**
   * Loads what is saved for this user and Media Type; with `resume`, a saved Ranking opens straight away.
   * Returns whether a usable Ranking was found.
   */
  function openRanking(key: RankingKey, resume: boolean): boolean {
    setMediaType(key.mediaType)
    setRankingUi(leftRanking)
    imports.open(key)
    const opened = lifecycle.open(key)
    setStatuses(opened.statuses)
    // Saved progress exists but can't be used: nothing of it shows, and Start is blocked so it isn't overwritten.
    if (opened.kind === 'unusable') {
      setSavedBroken(true)
      setNotice({
        tone: 'error',
        message: `Your saved ${MEDIA_LABEL[key.mediaType]} progress in this browser can't be used (${opened.message}). It was left untouched.`,
        action: { label: 'Restore a Backup', onClick: () => setDialog('restore') },
      })
      return false
    }
    setSavedBroken(false)
    const usable = opened.kind === 'usable'
    if (usable && resume) goTo('ranking')
    return usable
  }

  function endSession(deleteProgress: boolean) {
    writes.stop() // before the user's progress is deleted, so nothing written after is saved again
    catchUp.close()
    aniList.end(deleteProgress)
    setStatuses(DEFAULT_STATUSES)
    lifecycle.close()
    setSavedBroken(false)
    setRankingUi(leftRanking)
    imports.close()
    setScreen('start')
  }

  /** The login expired or was revoked: back to Start with "Log in again". */
  function loginExpired() {
    endSession(false)
    setNotice({
      tone: 'error',
      message: 'Your AniList login expired or was revoked.',
      action: { label: 'Log in again', onClick: loginRedirect },
    })
  }

  /** The unreachable banner, with Retry. */
  function aniListUnreachable() {
    setNotice({
      tone: 'error',
      message: 'AniList is unreachable right now.',
      action: { label: 'Retry', onClick: () => { setNotice(null); aniList.retry() } },
    })
  }

  /** The Viewer arrived: the Ranking of the Media Type last selected opens, on its Duels when there is one. */
  function openLastRanking(v: Viewer) {
    openRanking({ userId: v.id, mediaType: loadLastMediaType(storage, v.id) ?? 'ANIME' }, true)
  }

  // The browser refused to save the login: the banner says so once the user is known, so that its Backup is theirs.
  // Saved progress that can't be used keeps its own banner, which offers the Restore.
  const onUnsavedLogin = useEffectEvent(() => {
    if (!savedBroken) reportFailure({ reason: 'save-refused' })
  })
  useEffect(() => {
    if (viewerId !== null && !aniList.saved) onUnsavedLogin()
  }, [viewerId, aniList.saved])

  /**
   * Sync (#13, ADR 0005): brings the Pool in the log up to date with the fetched list and the chosen statuses.
   * Added titles go to Rough Sort, removed ones leave the Ranking; both are recorded as events Undo can't cross.
   * Runs on resume (once the list arrives), on Continue from Start (the statuses may have changed) and after a
   * Restore. Does nothing without a usable log or a list. Returns what changed, for a toast (null = nothing).
   */
  function syncPool(type: MediaType, fetched: readonly ListEntry[] | undefined, chosen: readonly ListStatus[]): string | null {
    const current = duelLog.latest()
    if (!viewer || !fetched || !current || current.log.header.mediaType !== type) return null
    const events = syncEvents(current.log, fetched, chosen, viewer.titleLanguage)
    if (events.length === 0) return null
    const synced = duelLog.append(...events)
    if (!synced.ok) {
      reportFailure(synced, (why) => `Your ${MEDIA_LABEL[type]} Pool couldn't be brought up to date (${why}). Your progress was left untouched.`)
      return null
    }
    const added = events.reduce((sum, e) => sum + (e.type === 'titles-added' ? e.ids.length : 0), 0)
    const removed = events.reduce((sum, e) => sum + (e.type === 'titles-removed' ? e.ids.length : 0), 0)
    if (added > 0) setRankingUi(titlesAdded)
    // A Keep My Scale Pool never grows (ADR 0011), so only Rough Sort ever gets titles added.
    const changes = [added > 0 && `${count(added, 'title')} added to Rough Sort`, removed > 0 && `${count(removed, 'title')} left the Ranking`]
    return `Pool updated: ${changes.filter(Boolean).join(' · ')}`
  }

  /** A freshly read list is the moment to sync a saved Ranking (resume, also months after an Import, or after Catch-up). */
  function syncFetched(type: MediaType, fetched: ListEntry[]) {
    const summary = syncPool(type, fetched, statuses)
    if (summary) showToast(summary)
  }

  // Bands that can be split now (ADR 0006): the menu offers them.
  const offers = ranking ? splitOffers(ranking) : []

  // Back in Rough Sort (Undo, or a sync before the first Duel): finishing it shows the last check again.
  if (lastCheckContinued && ranking?.prompt.kind === 'rough-sort') patchRankingUi({ lastCheckContinued: false })

  /** The Board's entry points (Rough Sort pill, Band choice pill, menu) while it is open: before the first Duel answer. */
  function openBoard() {
    apply(boardOpened(ranking))
  }

  /** Skip on a split offer: the Band isn't offered again in this session. */
  function skipSplit(band: BandIndex) {
    setRankingUi((s) => splitSkipped(s, band))
    showToast(<>Skipped. {BAND_UI[band].label} stays one Band</>)
  }

  /** "Continue →" on the last check: the Band choice comes next. */
  function continueFromLastCheck() {
    apply(lastCheckLeft(ranking, screen))
  }

  /**
   * What the user sees when the Duel log stayed as it was, or a Ranking was not started. The browser refused to save:
   * the screen stays on what is saved, and the banner offers a Backup of it. The log doesn't replay: the caller's
   * sentence, given the engine's message, or nothing where the caller says to ignore it. No open log, something in
   * the way of a new Ranking, nothing to replace: nothing, the screens already prevent them. Only a refused save on
   * its own (of something saved beside the log) comes without that choice: nothing was replayed.
   */
  function reportFailure(failure: { reason: 'save-refused' }): void
  function reportFailure(failure: DuelLogFailure | StartFailure, notReplayed: ((why: string) => string) | 'ignore'): void
  function reportFailure(failure: DuelLogFailure | StartFailure, notReplayed?: ((why: string) => string) | 'ignore') {
    switch (failure.reason) {
      case 'save-refused':
        setNotice({
          tone: 'error',
          message: "That couldn't be saved: this browser's storage is full or blocked. Save a Backup to keep your progress so far.",
          action: { label: 'Save Backup', onClick: saveBackup },
        })
        return
      case 'does-not-replay':
        if (typeof notReplayed === 'function') setNotice({ tone: 'error', message: notReplayed(failure.message) })
        return
      case 'no-open-log':
      case 'in-the-way':
      case 'nothing-to-replace':
        return
    }
  }

  /**
   * Appends one answer, checks it replays, and saves the log before showing the result. Returns the new state, or
   * null if the answer was dropped. Once a fix started from Preview is placed (or undone), Preview opens again; so
   * it does once the Refine Duels started from Preview are all answered.
   */
  function answer(event: LogEvent): RankingState | null {
    const appended = duelLog.append(event)
    if (!appended.ok) {
      // An answer that doesn't replay is one for a prompt that is no longer showing (e.g. a double key press).
      reportFailure(appended, 'ignore')
      return null
    }
    const state = appended.ranking
    const after = answered(rankingUi, state, screen)
    apply(after)
    if (after.refineEnded) showToast(state.keepMyScale ? 'Every title has a score' : 'Every score is settled again')
    return state
  }

  const nameOf = (id: number) => titleName(viewer ? entries.get(id) : undefined, id, viewer?.titleLanguage ?? 'ROMAJI')

  /** Band moved (ADR 0005): the title is placed next in its new (Sub-)band. The toast offers Undo while nothing else happened. */
  function moveTitle(id: number, band: BandIndex, sub?: SubBandIndex) {
    const state = answer(withSub({ type: 'band-moved', id, band }, sub))
    if (!state) return null
    const moved = duelLog.latest()
    showToast(
      <>
        Moved <b>{nameOf(id)}</b> to <Kao band={band} size={11} />
        {sub !== undefined && (
          <>
            {' › '}
            <SubPill sub={sub} size={11} />
          </>
        )}{' '}
        <button className="link" onClick={() => duelLog.latest() === moved && answer({ type: 'undo' })}>
          Undo
        </button>
      </>,
    )
    return state
  }

  /**
   * Re-rank / Move / Bring back from Preview: the title's Duels run on the Ranking screen, then Preview opens again.
   * A title that needs no Duel (e.g. moved into an empty Band) is placed at once and Preview stays.
   */
  function fixFromPreview(id: number, verb: string, state: RankingState | null) {
    if (!state) return
    const started = fixStarted(state, id, verb)
    apply(started)
    // A move keeps its own toast (with Undo).
    if (started.noDuelNeeded && verb !== 'Moving') {
      showToast(
        <>
          No Duels needed: <b>{nameOf(id)}</b> has its place
        </>,
      )
    }
  }

  /** "Go to Duels →" on Preview (#29): the Refine Duels, from the top Band that has some. */
  function refineFromPreview() {
    const started = refineStarted(ranking)
    apply(started)
    if (started.bandFirst !== null) chooseBand(started.bandFirst)
  }

  /**
   * Duels go on in `band` (a split Band starts at its first Sub-band with titles to place). The Band choice gets
   * its own history entry, so Back from the Duel returns to it.
   */
  function chooseBand(band: BandIndex) {
    const state = duelLog.latest()?.ranking
    if (!state || state.progress.bands[band].done === state.progress.bands[band].total) return
    const alreadyThere = state.prompt.kind === 'duel' && !state.bandChoice && state.prompt.band === band
    if (!alreadyThere) answer({ type: 'band-selected', band })
    if (screen === 'ranking') window.history.replaceState({ screen: 'bands' }, '')
    goTo('ranking')
  }

  /** A new Ranking's log that the engine can't replay: nothing was saved, and the screen stays where it is. */
  const couldNotStart = (why: string) => `Your ${MEDIA_LABEL[mediaType]} Ranking couldn't be started (${why}).`

  /** `fromScores`: the user turned on Rough Sort from Scores (ADR 0008), a new Ranking only. */
  function startOrContinue(fromScores = false) {
    if (!viewer || !rankingKey) return
    if (!duelLog.latest()) {
      // Keep My Scale starts from the Picker instead (#64), so a new Ranking here always starts with Rough Sort.
      if (!start?.startOrder || start.newGoal === KEEP_MY_SCALE) return
      const { startOrder, newGoal, scoresPlan } = start
      const started = lifecycle.start(rankingKey, viewer.scoreFormat, { order: startOrder, goal: newGoal, fromScores: fromScores ? scoresPlan : null })
      if (!started.ok) return reportFailure(started, couldNotStart)
    } else {
      // The statuses may have changed on Start: titles that now match join, the rest leave.
      const summary = syncPool(mediaType, list, statuses)
      if (summary) showToast(summary)
    }
    goTo('ranking')
  }

  /**
   * Preview opens once the fresh `Viewer` check is through (spec Auth, ADR 0003). If the Score Format changed since
   * best / worst were chosen, they were converted to the new format, and a blue banner says so.
   */
  function openPreview() {
    const onKeepMyScale = ranking !== null && isKeepMyScale(ranking)
    void imports.openPreview().then((checked) => {
      if (!checked) return
      if (checked.converted) {
        // Keep My Scale has no best / worst: its scores are the Anchors', shown in the new Score Format.
        const check = onKeepMyScale ? 'Check the new scores' : 'Best / Worst were converted. Check them'
        setNotice({
          tone: 'info',
          message: `Your Score Format changed to ${SCORE_FORMAT_LABEL[checked.format]}. ${check} before importing.`,
        })
      }
      goTo('preview')
    })
  }

  /**
   * Where a resumed (or retried) Import ended up: on the Import screen to be confirmed again or written, or dropped,
   * with a blue banner saying why and the Import screen left for Preview (or the Duels of an unfinished Ranking).
   */
  function showResumed(progress: ImportProgress | null) {
    if (!progress) return
    if (progress.stage === 'dropped') {
      setNotice({ tone: 'info', message: droppedMessage(progress) })
      if (screen === 'import') goTo(progress.previewOpen ? 'preview' : 'ranking')
    } else if (screen !== 'import') goTo('import')
  }

  /** Settings changed on Preview go into the Duel log (ADR 0007), so a reload or a Backup gives the same scores. */
  function changeScoring(settings: ScoringSettings) {
    if (!viewer) return
    const changed = duelLog.append({ type: 'scoring-set', format: viewer.scoreFormat, settings })
    if (!changed.ok) {
      reportFailure(changed, (why) => `Your Ranking's scoring settings couldn't be changed (${why}). Your progress was left untouched.`)
    }
  }

  /**
   * Switches the open Ranking's Sort Goal (#28, ADR 0007): its settings move to the new goal's Score Step. Every
   * earlier answer still counts. Preview keeps showing the new settings.
   */
  function applySortGoal(goal: SwitchableGoal) {
    const current = duelLog.latest()
    if (!viewer || !current) return
    const key = { userId: viewer.id, mediaType }
    const events = switchGoalEvents(current.ranking, loadScoringSettings(storage, key), viewer.scoreFormat, goal)
    if (events.length === 0) return
    const switched = duelLog.append(...events)
    if (!switched.ok) {
      return reportFailure(switched, (why) => `Your Ranking couldn't switch its Sort Goal (${why}). Your progress was left untouched.`)
    }
    showToast(
      goal === 'scores' ? (
        <>
          Switched to <b>Scores</b> · Duels stop once every score is settled
        </>
      ) : (
        <>
          Switched to <b>Full Ranking</b> · every title gets its own place
        </>
      ),
    )
  }

  /** The menu, Start and Preview: Scores switches at once; Full Ranking asks first, with "+~N Duels" (#25). */
  function requestSortGoal(goal: SwitchableGoal) {
    if (goal === 'full-ranking') setDialog('full-ranking')
    else applySortGoal(goal)
  }

  /** Downloads the Backup file for the current user and Media Type. */
  function saveBackup() {
    if (!viewer) return
    const file = createBackup(storage, { userId: viewer.id, mediaType, userName: viewer.name }, new Date())
    if (!file) {
      showToast(`There is no ${MEDIA_LABEL[mediaType]} Ranking to back up yet.`)
      return
    }
    const url = URL.createObjectURL(new Blob([file.json], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = file.fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    showToast(
      <>
        Saved <b>{file.fileName}</b>
      </>,
    )
  }

  /** Runs only after the user confirmed in the Restore dialog, which already checked the file for this user and Media Type. */
  function restore(backup: Backup) {
    if (!rankingKey) return
    restoreBackup(storage, backup)
    setDialog(null)
    setNotice(null)
    const restored = `Restored ${backup.log.events.length} events from Backup`
    if (!openRanking(rankingKey, false)) {
      showToast(restored)
      return
    }
    // The Backup may be older than the list: bring its Pool up to date under the restored statuses.
    const chosen = loadPoolSettings(storage, rankingKey)?.statuses ?? DEFAULT_STATUSES
    const summary = syncPool(mediaType, list, chosen)
    goTo('ranking')
    showToast(summary ? `${restored} · ${summary}` : restored)
  }

  /** The Picker opens under its own history entry, so Back from it returns to where it was opened. */
  function showPicker() {
    goTo('picker')
  }

  /** A Keep My Scale Ranking just started: on to its Duels, with the Picker out of the history, so Back goes to Start. */
  function showKeepMyScaleDuels() {
    window.history.replaceState({ screen: 'start' }, '')
    goTo('ranking')
  }

  /** A Keep My Scale Ranking was saved over the saved Scores / Full Ranking Ranking (#46). */
  function keepMyScaleReplaced(key: RankingKey) {
    setNotice(null)
    // What only made sense for the old Ranking goes with it; its unfinished Import, if any, is no longer offered.
    setRankingUi(leftRanking)
    imports.open(key)
    setPickedGoal(KEEP_MY_SCALE)
    showKeepMyScaleDuels()
    showToast(`Your ${MEDIA_LABEL[key.mediaType]} Ranking was replaced by Keep My Scale.`)
  }

  /** Runs only after the user confirmed in the Start over dialog. */
  function startOver() {
    if (!rankingKey) return
    lifecycle.startOver(rankingKey)
    setDialog(null)
    setNotice(null)
    openRanking(rankingKey, false)
    goTo('start')
    showToast(`Your ${MEDIA_LABEL[mediaType]} Ranking was thrown away.`)
  }

  function switchMediaType(type: MediaType) {
    if (!viewer || type === mediaType) return
    saveLastMediaType(storage, viewer.id, type)
    const inRankingNow = screen === 'ranking'
    if (!openRanking({ userId: viewer.id, mediaType: type }, inRankingNow) && inRankingNow) goTo('start')
  }

  /** Catch-up, from the menu or the mochi on Start: anime only, whichever Ranking is open. */
  function openCatchUp() {
    if (screen !== 'catchup') goTo('catchup')
    void catchUp.open()
  }

  /** Runs only after the user confirmed in the Clear Passed dialog. */
  function clearPassed() {
    catchUp.clearPassed()
    showToast('Catch-up’s Passed list is cleared')
  }

  /**
   * Leaving Catch-up through its exit offer, on anime. A Keep My Scale offer opens the Picker with every unscored
   * Completed and Repeating title ticked (#65), asking first about remembered unsettled titles (#66); Keep My Scale
   * is picked so Back leads to Start with it selected, and Confirm asks to replace a Ranking on another Sort Goal.
   * Otherwise on to Start: nothing is picked so the Sort Goal follows the Pool size (#38); a saved Ranking shows as it is.
   */
  function takeExitOffer(offer: ExitOffer) {
    switchMediaType('ANIME')
    if (offer.target === 'picker') {
      setPickedGoal(KEEP_MY_SCALE)
      // Start goes into the history under the Picker, so Back from the Picker lands there.
      goTo('start')
      keepMyScale.openPicker({ from: 'catch-up' }, 'ANIME')
      return
    }
    if (offer.target === 'default-sort-goal') setPickedGoal(null)
    goTo('start')
  }

  const hasProgress = Boolean(log) || savedBroken
  const passedHidden = passedStore?.hiddenCount(browserClock.now()) ?? 0
  const menuItems = viewer
    ? buildMenuItems(
        { mediaType, statuses, hasLog: Boolean(log), hasProgress, ranking, choosingBand: screen === 'bands', splitOffers: offers, passedHidden },
        {
          switchMediaType: (type) => {
            switchMediaType(type)
            showToast(
              <>
                Switched to <b>{MEDIA_LABEL[type]}</b> — your {MEDIA_LABEL[mediaType]} Ranking is kept
              </>,
            )
          },
          changeStatuses: () => goTo('start'),
          saveBackup,
          chooseBand: () => goTo('bands'),
          splitBand: (band) => {
            patchRankingUi({ splitView: { band } })
            goTo('ranking')
          },
          openBoard,
          restore: () => setDialog('restore'),
          startOver: () => setDialog('start-over'),
          toggleTheme,
          logout: () => setDialog('logout'),
          switchSortGoal: requestSortGoal,
          openCatchUp,
          clearPassed: () => setDialog('clear-passed'),
        },
      )
    : []

  const form = viewer && start
    ? {
        ...start.form,
        viewer,
        mediaType,
        // Choosing Keep My Scale only selects it, even over a saved Ranking on another Sort Goal: the Picker's Confirm
        // asks to replace that one (#64). Another goal over a saved Ranking switches it, as from the menu.
        onGoal: (goal: SortGoal) => {
          if (!ranking || goal === KEEP_MY_SCALE) setPickedGoal(goal)
          else {
            setPickedGoal(null)
            if (goal !== goalOf(ranking)) requestSortGoal(goal)
          }
        },
        onMediaType: switchMediaType,
        onToggleStatus: (s: ListStatus) => {
          const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]
          // The chip changes for this visit either way; the banner says when it couldn't be saved.
          if (!lifecycle.saveStatuses({ userId: viewer.id, mediaType }, next).saved) reportFailure({ reason: 'save-refused' })
          setStatuses(next)
        },
        onLogout: () => setDialog('logout'),
        onStartRoughSort: savedBroken ? undefined : startOrContinue,
        onChooseTitles: savedBroken ? undefined : () => keepMyScale.openPicker({ from: 'start' }),
        onRestore: () => setDialog('restore'),
        catchUp: {
          sign: startSign(mediaType, catchUp.queue),
          watched: mediaType === 'ANIME' && list ? watchedCount(list) : null,
          nearEmpty: mediaType === 'ANIME' && list ? isNearEmpty(list) : false,
          onOpen: openCatchUp,
        },
      }
    : null
  // Catch-up's exit offer (#52) is about anime, whichever Media Type is selected: on Manga, the anime Ranking and
  // statuses are the saved ones.
  const animeList = lists.ANIME
  const savedAnimeStart = useMemo((): StartView | null => {
    if (mediaType === 'ANIME' || viewerId === null || !viewerFormat || !titleLanguage) return null
    const saved = lifecycle.saved({ userId: viewerId, mediaType: 'ANIME' })
    return startView({
      list: animeList ?? null,
      statuses: saved.statuses,
      scoreFormat: viewerFormat,
      titleLanguage,
      picked: null,
      saved: saved.kind === 'usable' ? { log: saved.log, ranking: saved.ranking } : null,
      savedBroken: saved.kind === 'unusable',
    })
  }, [lifecycle, mediaType, viewerId, viewerFormat, titleLanguage, animeList])
  const animeStart = mediaType === 'ANIME' ? start : savedAnimeStart
  // The offer waits until the saves are written and the list read again, so it counts the titles just added.
  const offer = exitOffer({ added: catchUp.added, anime: catchUp.listed && animeStart ? animeStanding(animeStart) : null })

  // The one screen to show; everything below renders by it.
  const shown = shownScreen({
    screen,
    viewer,
    ranking,
    log,
    listLoaded: Boolean(list),
    notice: Boolean(notice),
    oldScores,
    rankingUi,
    preview: imports.preview,
    importing: imports.importing,
    keepMyScaleEligible: Boolean(start?.eligibility?.eligible),
    savedBroken,
  })
  // The open Ranking the screen belongs to: the sidebar shows beside it.
  const inRanking = rankingShown(shown)
  const splitBand = inRanking && splitBandOf(inRanking.ranking, log, rankingUi)
  const previewScoring = shown.kind === 'preview' ? shown.scoring : null
  const ticks = imports.ticks
  const previewRead = useMemo(
    () =>
      previewScoring && ranking && oldScores && viewerFormat && titleLanguage
        ? readPreview(ranking, viewerFormat, previewScoring, oldScores, (id) => titleName(entries.get(id), id, titleLanguage), ticks)
        : null,
    [previewScoring, ranking, viewerFormat, oldScores, entries, titleLanguage, ticks],
  )
  // A cut-off Import (or one with failures) is offered again until it finishes, the plan is dropped, or Start over:
  // "Your last Import didn't finish" with Resume (once the list is loaded), unless the Import screen is showing.
  const unfinishedImport = viewer && screen !== 'import' ? imports.unfinished : null
  const unfinishedSummary = unfinishedImport && importSummary(unfinishedImport)
  const resumeNotice: Notice | null = unfinishedSummary && {
    tone: 'info',
    message: `Your last Import didn't finish: ${unfinishedSummary.left + unfinishedSummary.failed} of ${unfinishedSummary.total} scores still to write.`,
    action: list ? { label: 'Resume Import', onClick: () => void imports.resume().then(showResumed) } : undefined,
  }

  return (
    <Shell
      notice={notice ?? resumeNotice}
      toast={toast?.message}
      sidebar={
        inRanking ? (
          <RankingSidebar
            viewer={inRanking.viewer}
            mediaType={mediaType}
            state={inRanking.ranking}
            entries={entries}
            titleLanguage={inRanking.viewer.titleLanguage}
            offered={splitBand !== null && !inRanking.ranking.bands[splitBand].subBands ? [splitBand] : undefined}
            menu={
              <AccountMenu
                name={inRanking.viewer.name}
                avatarUrl={inRanking.viewer.avatarUrl}
                detail={`${MEDIA_LABEL[mediaType]} · ${count(inRanking.ranking.progress.roughSort.total, 'title')}`}
                items={menuItems}
              />
            }
          />
        ) : undefined
      }
    >
      <Screens
        shown={shown}
        storage={storage}
        mediaType={mediaType}
        list={list}
        entries={entries}
        nameOf={nameOf}
        start={{
          form,
          covers,
          loggingIn: Boolean(token) && !viewer && !notice,
          onLogin: loginRedirect,
          theme,
          onToggleTheme: toggleTheme,
        }}
        pickerWayIn={keepMyScale.wayIn}
        pickAgain={keepMyScale.pickAgain}
        onConfirmPicks={keepMyScale.confirm}
        catchUp={catchUp}
        exitOffer={offer}
        onTakeExitOffer={takeExitOffer}
        imports={imports}
        onResumed={showResumed}
        previewRead={previewRead}
        previewFix={previewFix}
        previewMoving={previewMoving}
        onSettings={changeScoring}
        onSwitchGoal={requestSortGoal}
        onRefine={refineFromPreview}
        onFixFromPreview={fixFromPreview}
        onOpenPreview={openPreview}
        answer={answer}
        moveTitle={moveTitle}
        goTo={goTo}
        patchRankingUi={patchRankingUi}
        onChooseBand={chooseBand}
        onSkipSplit={skipSplit}
        onContinueFromLastCheck={continueFromLastCheck}
        onOpenBoard={openBoard}
      />
      {viewer && !dialog && previewMoving === null && <CommandPalette items={menuItems} />}
      <AppDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        viewer={viewer}
        mediaType={mediaType}
        list={list}
        ranking={ranking}
        log={log}
        hasProgress={hasProgress}
        passedHidden={passedHidden}
        unsettledStore={unsettledStore}
        onLogout={endSession}
        onRestore={restore}
        onFullRanking={() => applySortGoal('full-ranking')}
        onClearPassed={clearPassed}
        onReplaceWithKeepMyScale={keepMyScale.replace}
        onCancelReplace={keepMyScale.cancelReplace}
        onEnterPicker={keepMyScale.enterPicker}
        onStartOver={startOver}
        onSaveBackup={saveBackup}
      />
    </Shell>
  )
}
