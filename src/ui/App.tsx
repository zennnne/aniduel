// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { AniListError, createAniListGateway, trendingCovers, type AniListSession } from '../anilist/gateway.ts'
import type { Cover, ListEntry, ListStatus, MediaType, Viewer } from '../anilist/types.ts'
import { authorizeUrl, logout, restoreSession } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import { createBackup, restoreBackup, type Backup } from '../persistence/backup.ts'
import type { DuelLogFailure } from '../persistence/duelLogStore.ts'
import { createSplitChoiceStore } from '../persistence/splitChoice.ts'
import { createUnsettledStore } from '../persistence/unsettledTitles.ts'
import { browserClock } from '../clock.ts'
import { importSummary } from '../import/importState.ts'
import type { DroppedImport, ImportProgress } from '../import/previewImport.ts'
import { createRequestLimiter } from '../writes/limiter.ts'
import {
  deleteDuelLog,
  loadDuelLog,
  loadLastMediaType,
  loadPoolSettings,
  loadScoringSettings,
  SaveError,
  saveLastMediaType,
  savePoolSettings,
  type RankingKey,
} from '../persistence/progress.ts'
import { DEFAULT_STATUSES, LIST_STATUSES } from '../pool/pool.ts'
import { syncEvents } from '../pool/sync.ts'
import {
  KEEP_MY_SCALE,
  answeredDuels,
  appendEvent,
  promptedTitle,
  replay,
  startLog,
  startKeepMyScaleLog,
  withSub,
  type BandIndex,
  type DuelLog,
  type LogEvent,
  type RankingState,
  type SortGoal,
  type SubBandIndex,
  type SwitchableGoal,
} from '../ranking/engine.ts'
import { fullRankingExtra } from '../ranking/estimate.ts'
import { previewOpen, readPreview } from '../ranking/preview.ts'
import { hasHumanStep, type ScoringSettings } from '../ranking/scoring.ts'
import { goalOf, isKeepMyScale, switchGoalEvents } from '../ranking/sortGoal.ts'
import { splitOffers } from '../ranking/split.ts'
import { BAND_UI } from './bands.ts'
import { aniListCandidateSource } from '../catchup/suggestionCandidates.ts'
import { createPassedStore } from '../catchup/passed.ts'
import { BandChoiceScreen } from './bandchoice/BandChoiceScreen.tsx'
import { isNearEmpty, startSign, watchedCount } from '../catchup/entry.ts'
import { isWatched } from '../catchup/watched.ts'
import { exitOffer, type ExitOffer } from '../catchup/exitOffer.ts'
import { CatchUpScreen } from './catchup/CatchUpScreen.tsx'
import { StartingEraChip, StartingEraQuestion } from './catchup/StartingEraQuestion.tsx'
import { ClearPassedDialog } from './catchup/ClearPassedDialog.tsx'
import { ExitOfferButton } from './catchup/ExitOfferButton.tsx'
import { useCatchUp } from './catchup/useCatchUp.ts'
import { BoardScreen } from './board/BoardScreen.tsx'
import { SplitScreen } from './split/SplitScreen.tsx'
import { CloserToScreen } from './duel/CloserToScreen.tsx'
import { CompleteScreen } from './duel/CompleteScreen.tsx'
import { DuelScreen } from './duel/DuelScreen.tsx'
import { Kao, SubPill } from './Kao.tsx'
import { MoveSheet } from './move/MoveSheet.tsx'
import { LogoutDialog } from './LogoutDialog.tsx'
import { FullRankingDialog } from './menu/FullRankingDialog.tsx'
import { AccountMenu, CommandPalette } from './menu/AppMenu.tsx'
import { buildMenuItems } from './menu/buildMenuItems.ts'
import { ReplaceWithKeepMyScaleDialog, RestoreDialog, StartOverDialog } from './menu/BackupDialogs.tsx'
import { ImportScreen } from './import/ImportScreen.tsx'
import { usePreviewImport } from './import/usePreviewImport.ts'
import { useWriteQueue } from './useWriteQueue.ts'
import { MEDIA_LABEL, count, titleName } from './meta.ts'
import { PreviewScreen } from './preview/PreviewScreen.tsx'
import { SCORE_FORMAT_LABEL } from './preview/scoreFormat.ts'
import { RankingSidebar } from './RankingSidebar.tsx'
import { NO_RANKING_UI, leftRanking, splitSkipped, titlesAdded, type RankingUi } from './rankingUi.ts'
import { RoughSortScreen } from './roughsort/RoughSortScreen.tsx'
import { Shell, type Notice } from './Shell.tsx'
import { SCREENS, rankingShown, shownScreen, splitBandOf, type RankingShown, type Screen, type Shown } from './shownScreen.ts'
import { PickAgainDialog } from './picker/PickAgainDialog.tsx'
import { PickerScreen } from './picker/PickerScreen.tsx'
import { startingPicks, type PickerStart, type PickerWayIn } from './picker/pickerView.ts'
import { StartScreen } from './start/StartScreen.tsx'
import { animeStanding, startView, type StartView } from './start/startView.ts'
import { useTheme } from './theme.ts'
import { useDuelLog } from './useDuelLog.ts'

type DialogName = 'logout' | 'restore' | 'start-over' | 'full-ranking' | 'clear-passed' | 'replace-with-keep-my-scale' | 'pick-again'

const TOAST_MS = 4000

/** Tiles in the Start collage. */
const COLLAGE_TILES = 36

function loginRedirect() {
  window.location.assign(authorizeUrl(aniListClientId({ dev: import.meta.env.DEV })))
}

/**
 * Whether a fix started from Preview (Re-rank, Move, Bring back) needs no more Duels: the Ranking is finished, or
 * only Refine Duels of other titles are left (on Scores the fixed title is worked on first, until it is settled).
 */
function fixDone(state: RankingState, id: number): boolean {
  return previewOpen(state.prompt) && promptedTitle(state.prompt) !== id
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

const browserFetch: typeof fetch = (...args) => window.fetch(...args)

/** `fake`: dev only (#68), a session on a fake AniList in place of the login and the network. */
export function App({ fake }: { fake?: AniListSession }) {
  const { theme, toggleTheme } = useTheme()
  const aniListFetch = fake?.fetch ?? browserFetch
  const [token, setToken] = useState<string | null>(() =>
    fake ? fake.token : restoreSession({ location: window.location, history: window.history, storage: localStorage }),
  )
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [lists, setLists] = useState<Partial<Record<MediaType, ListEntry[]>>>({})
  // Covers for Start before login. Left empty on failure: the collage falls back to placeholders.
  const [trending, setTrending] = useState<readonly Cover[]>([])
  const [mediaType, setMediaType] = useState<MediaType>('ANIME')
  const [statuses, setStatuses] = useState<readonly ListStatus[]>(DEFAULT_STATUSES)
  const duelLog = useDuelLog(localStorage)
  const { log, ranking } = duelLog
  // Saved progress that exists but can't be used. Starting over would overwrite it, so Start is blocked.
  const [savedBroken, setSavedBroken] = useState(false)
  const [screen, setScreen] = useState<Screen>('start')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [retries, setRetries] = useState(0)
  const [dialog, setDialog] = useState<DialogName | null>(null)
  // What only makes sense for the open Ranking; leaving it, whichever way, resets it all at once.
  const [rankingUi, setRankingUi] = useState(NO_RANKING_UI)
  const { lastCheckContinued, previewFix, refining, previewMoving } = rankingUi
  const patchRankingUi = (change: Partial<RankingUi>) => setRankingUi((s) => ({ ...s, ...change }))
  // A new object per toast, so showing the same message twice restarts its timer.
  const [toast, setToast] = useState<{ message: ReactNode } | null>(null)
  // The Sort Goal the user picked on Start for a new Ranking (#28), or null while they haven't touched it and it
  // follows the Pool size (#38). A saved Ranking's goal lives in its log. Not reset on logout: logging in again loads the page anew.
  const [pickedGoal, setPickedGoal] = useState<SortGoal | null>(null)
  // How the Picker was last opened, which decides its starting picks (#64); the picks themselves live in the Picker.
  const [pickerWayIn, setPickerWayIn] = useState<PickerWayIn>({ from: 'start' })
  // The remembered unsettled titles the user chose to pick again on the way in (#66); empty when they said no.
  const [pickAgain, setPickAgain] = useState<readonly number[]>([])
  // What the Picker's Confirm would start, held while the Replace dialog asks about the saved Ranking.
  const [pickedStart, setPickedStart] = useState<PickerStart | null>(null)

  const gateway = useMemo(() => (token ? createAniListGateway({ fetch: aniListFetch, token }) : null), [aniListFetch, token])
  // The write queue's requests and Catch-up's reads take turns in one limiter, so together they keep to AniList's rate limit.
  const limiter = useMemo(() => (token ? createRequestLimiter(browserClock) : null), [token])
  const candidateSource = useMemo(
    () => (token && limiter ? aniListCandidateSource({ fetch: aniListFetch, token, clock: browserClock, limiter }) : null),
    [aniListFetch, token, limiter],
  )
  const viewerId = viewer?.id ?? null
  // One write queue for Import's scores and Catch-up's statuses.
  const writes = useWriteQueue({ storage: localStorage, gateway, userId: viewerId, limiter, onError: handleGatewayError })
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
  // The anime list without its Planning titles, as Catch-up reads it (it reads Planning itself, fresh).
  const watchedAnime = useMemo(() => lists.ANIME?.filter(isWatched) ?? null, [lists.ANIME])

  const imports = usePreviewImport({
    storage: localStorage,
    gateway,
    queue: writes.queue,
    viewer,
    duelLog,
    oldScores,
    name: (id, language) => titleName(entries.get(id), id, language),
    onViewer: setViewer,
    onGatewayError: handleGatewayError,
    onDuelLogFailure: (failure) =>
      reportFailure(failure, (why) => `Your Ranking's scoring settings couldn't be brought up to date (${why}). Your progress was left untouched.`),
    onWritten: (key, written) =>
      // Preview should show the scores AniList has now.
      setLists((prev) => {
        const current = prev[key.mediaType]
        if (!current) return prev
        return { ...prev, [key.mediaType]: current.map((e) => (written.has(e.mediaId) ? { ...e, oldScore100: written.get(e.mediaId)! } : e)) }
      }),
    onFinished: endKeepMyScale,
  })

  // The titles the last Keep My Scale Ranking left unsettled, for this user and Media Type (#66).
  const unsettledStore = useMemo(() => (viewerId === null ? null : createUnsettledStore(localStorage, { userId: viewerId, mediaType })), [viewerId, mediaType])

  const passedStore = useMemo(() => (viewerId === null ? undefined : createPassedStore(localStorage, viewerId)), [viewerId])
  const catchUp = useCatchUp({
    storage: localStorage,
    passedStore,
    gateway,
    animeList: watchedAnime,
    queue: writes.queue,
    source: candidateSource,
    viewer,
    clock: browserClock,
    seed: newSeed,
    onGatewayError: handleGatewayError,
    // Titles Catch-up added can join the anime Pool: read the list again, which syncs a saved Ranking.
    onWritten: () => refreshList('ANIME'),
  })

  const needTrending = !token && trending.length === 0
  useEffect(() => {
    if (!needTrending) return
    let cancelled = false
    trendingCovers({ fetch: aniListFetch }, COLLAGE_TILES)
      .then((covers) => !cancelled && setTrending(covers))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [needTrending, aniListFetch])

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
    setStatuses(loadPoolSettings(localStorage, key)?.statuses ?? DEFAULT_STATUSES)
    /** Saved progress exists but can't be used: nothing of it shows, and Start is blocked so it isn't overwritten. */
    const unusable = (why: string) => {
      duelLog.close()
      setSavedBroken(true)
      setNotice({
        tone: 'error',
        message: `Your saved ${MEDIA_LABEL[key.mediaType]} progress in this browser can't be used (${why}). It was left untouched.`,
        action: { label: 'Restore a Backup', onClick: () => setDialog('restore') },
      })
      return false
    }
    let saved: DuelLog | null
    try {
      saved = loadDuelLog(localStorage, key)
    } catch (e) {
      return unusable(e instanceof Error ? e.message : 'unknown error')
    }
    if (saved) {
      // Replayed first: nothing shows from a log the engine can't replay.
      const shown = duelLog.show(saved)
      if (!shown.ok) return unusable(shown.reason === 'does-not-replay' ? shown.message : 'unknown error')
    } else duelLog.close()
    setSavedBroken(false)
    if (saved && resume) goTo('ranking')
    return saved !== null
  }

  function endSession(deleteProgress: boolean) {
    writes.stop() // before the user's progress is deleted, so nothing written after is saved again
    catchUp.close()
    // The fake session has no token of its own: the one in storage is the real login's, and stays.
    if (!fake) logout(localStorage, { userId: viewer?.id ?? null, deleteProgress })
    setToken(null)
    setViewer(null)
    setLists({})
    setStatuses(DEFAULT_STATUSES)
    duelLog.close()
    setSavedBroken(false)
    setRankingUi(leftRanking)
    imports.close()
    setScreen('start')
  }

  /** Login expired → back to Start with "Log in again"; anything else → the unreachable banner with Retry. */
  function handleGatewayError(error: unknown) {
    if (error instanceof AniListError && error.kind === 'auth') {
      endSession(false)
      setNotice({
        tone: 'error',
        message: 'Your AniList login expired or was revoked.',
        action: { label: 'Log in again', onClick: loginRedirect },
      })
      return
    }
    setNotice({
      tone: 'error',
      message: 'AniList is unreachable right now.',
      action: { label: 'Retry', onClick: () => { setNotice(null); setRetries((n) => n + 1) } },
    })
  }

  const onGatewayError = useEffectEvent(handleGatewayError)

  const onViewer = useEffectEvent((v: Viewer) => {
    setViewer(v)
    openRanking({ userId: v.id, mediaType: loadLastMediaType(localStorage, v.id) ?? 'ANIME' }, true)
  })

  useEffect(() => {
    if (!gateway || viewer) return
    let cancelled = false
    gateway.viewer().then(
      (v) => !cancelled && onViewer(v),
      (e: unknown) => !cancelled && onGatewayError(e),
    )
    return () => {
      cancelled = true
    }
  }, [gateway, viewer, retries])

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

  // A freshly fetched list is the moment to sync a saved Ranking (resume, also months after an Import).
  const onListFetched = useEffectEvent((type: MediaType, fetched: ListEntry[]) => {
    setLists((prev) => ({ ...prev, [type]: fetched }))
    const summary = syncPool(type, fetched, statuses)
    if (summary) showToast(summary)
  })

  /**
   * Reads a list again (after Catch-up wrote to it), syncing a saved Ranking like a first fetch. Resolves once it is
   * read, or couldn't be. A first read still in flight is dropped when this one lands: it may have left before the write.
   */
  function refreshList(type: MediaType): Promise<void> {
    if (!gateway || !viewer) return Promise.resolve()
    return gateway.mediaList({ userId: viewer.id, type, statuses: LIST_STATUSES }).then(
      (fetched) => {
        setLists((prev) => ({ ...prev, [type]: fetched }))
        const summary = syncPool(type, fetched, statuses)
        if (summary) showToast(summary)
      },
      () => {}, // the next list read catches up
    )
  }

  // The selected Media Type's list, and in Catch-up the anime list too: its exit offer checks the Anchors there (#52).
  const listToFetch: MediaType | null = !lists[mediaType] ? mediaType : screen === 'catchup' && !lists.ANIME ? 'ANIME' : null
  useEffect(() => {
    if (!gateway || !viewer || !listToFetch) return
    let cancelled = false
    // Fetch every status once, so each chip can show its count and toggling needs no refetch. Planning comes too,
    // for Keep My Scale's Anchors and Pool (LIST_STATUSES); nothing shows or offers those titles.
    gateway.mediaList({ userId: viewer.id, type: listToFetch, statuses: LIST_STATUSES }).then(
      (list) => !cancelled && onListFetched(listToFetch, list),
      (e: unknown) => !cancelled && onGatewayError(e),
    )
    return () => {
      cancelled = true
    }
  }, [gateway, viewer, listToFetch, retries])

  // Bands that can be split now (ADR 0006): the menu offers them.
  const offers = ranking ? splitOffers(ranking) : []

  // Back in Rough Sort (Undo, or a sync before the first Duel): finishing it shows the last check again.
  if (lastCheckContinued && ranking?.prompt.kind === 'rough-sort') patchRankingUi({ lastCheckContinued: false })

  /** The Board's entry points (Rough Sort pill, Band choice pill, menu) while it is open: before the first Duel answer. */
  function openBoard() {
    if (!ranking?.board.open) return
    if (ranking.prompt.kind === 'rough-sort') goTo('board')
    else patchRankingUi({ lastCheckContinued: false })
  }

  /** "Continue →" on the last check: the Band choice comes next. */
  function continueFromLastCheck() {
    patchRankingUi({ lastCheckContinued: true })
    if (ranking?.prompt.kind === 'duel' && screen !== 'bands') goTo('bands')
  }

  /**
   * What the user sees when the Duel log stayed as it was. The browser refused to save: the screen stays on what is
   * saved, and the banner offers a Backup of it. The log doesn't replay: the caller's sentence, given the engine's
   * message, or nothing where the caller says to ignore it. No open log: nothing. Only a refused save on its own
   * (of something saved beside the log) comes without that choice: nothing was replayed.
   */
  function reportFailure(failure: { reason: 'save-refused' }): void
  function reportFailure(failure: DuelLogFailure, notReplayed: ((why: string) => string) | 'ignore'): void
  function reportFailure(failure: DuelLogFailure, notReplayed?: ((why: string) => string) | 'ignore') {
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
        return
    }
  }

  /**
   * Appends one answer, checks it replays, and saves the log before showing the result. Returns the new state, or
   * null if the answer was dropped. Once a fix started from Preview is placed (or undone), Preview opens again; so
   * it does once the Refine Duels started from Preview are all answered.
   */
  function answer(event: LogEvent): RankingState | null {
    const answered = duelLog.append(event)
    if (!answered.ok) {
      // An answer that doesn't replay is one for a prompt that is no longer showing (e.g. a double key press).
      reportFailure(answered, 'ignore')
      return null
    }
    const state = answered.ranking
    if (previewFix && fixDone(state, previewFix.id)) {
      patchRankingUi({ previewFix: null })
      if (screen !== 'preview') goTo('preview')
    }
    if (refining && state.prompt.kind === 'all-complete') {
      patchRankingUi({ refining: false })
      if (screen !== 'preview') goTo('preview')
      showToast(state.keepMyScale ? 'Every title has a score' : 'Every score is settled again')
    }
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
    if (fixDone(state, id)) {
      // A move keeps its own toast (with Undo).
      if (verb !== 'Moving') {
        showToast(
          <>
            No Duels needed: <b>{nameOf(id)}</b> has its place
          </>,
        )
      }
      return
    }
    patchRankingUi({ previewFix: { id, verb } })
    goTo('ranking')
  }

  /** "Go to Duels →" on Preview (#29): the Refine Duels, from the top Band that has some. */
  function refineFromPreview() {
    const kind = ranking?.prompt.kind
    if (!ranking || (kind !== 'duel' && kind !== 'anchor-duel' && kind !== 'closer-to')) return
    patchRankingUi({ refining: true })
    if (ranking.bandChoice) chooseBand(ranking.bandChoice.next)
    else goTo('ranking')
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
    if (!viewer) return
    if (!duelLog.latest()) {
      // Keep My Scale starts from the Picker instead (#64), so a new Ranking here always starts with Rough Sort.
      if (!start?.startOrder || start.newGoal === KEEP_MY_SCALE) return
      const { startOrder, newGoal, scoresPlan } = start
      // The new log carries its own Sort Goal and default scoring settings (ADR 0007).
      const started = startLog({ seed: newSeed(), userId: viewer.id, mediaType, ids: startOrder, scoreFormat: viewer.scoreFormat })
      // Full Ranking picked on Start: the same switch as from the menu, before anything is sorted.
      const log = switchGoalEvents(replay(started), null, viewer.scoreFormat, newGoal).reduce(appendEvent, started)
      const plan = fromScores && scoresPlan?.offerable ? scoresPlan : null
      const saved = duelLog.save(plan ? appendEvent(log, { type: 'bands-from-scores', bands: plan.bands }) : log)
      if (!saved.ok) return reportFailure(saved, couldNotStart)
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
    const events = switchGoalEvents(current.ranking, loadScoringSettings(localStorage, key), viewer.scoreFormat, goal)
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
    const file = createBackup(localStorage, { userId: viewer.id, mediaType, userName: viewer.name }, new Date())
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
    restoreBackup(localStorage, backup)
    setDialog(null)
    setNotice(null)
    const restored = `Restored ${backup.log.events.length} events from Backup`
    if (!openRanking(rankingKey, false)) {
      showToast(restored)
      return
    }
    // The Backup may be older than the list: bring its Pool up to date under the restored statuses.
    const chosen = loadPoolSettings(localStorage, rankingKey)?.statuses ?? DEFAULT_STATUSES
    const summary = syncPool(mediaType, list, chosen)
    goTo('ranking')
    showToast(summary ? `${restored} · ${summary}` : restored)
  }

  /**
   * Opens the Picker (#64); it starts from the picks for how it was opened. When the last Keep My Scale Ranking left
   * titles unsettled that the Picker can show, the user is first asked whether to pick them again (#66).
   */
  function openPicker(wayIn: PickerWayIn, type: MediaType = mediaType) {
    setPickerWayIn(wayIn)
    // Catch-up's exit offer switches to anime in the same click, so the store and list are read for `type`.
    const remembered = viewerId === null ? [] : createUnsettledStore(localStorage, { userId: viewerId, mediaType: type }).titles(lists[type] ?? [])
    if (remembered.length > 0) {
      setDialog('pick-again')
      return
    }
    enterPicker([])
  }

  /** Opens the Picker, with the remembered titles to tick on top of the way in's own (#66). */
  function enterPicker(remembered: readonly number[]) {
    setPickAgain(remembered)
    setDialog(null)
    goTo('picker')
  }

  /**
   * The Picker's Confirm (#64): starts the Keep My Scale Ranking on the picks, or first asks to replace a saved
   * Scores / Full Ranking Ranking (#46).
   */
  function confirmPicks(picks: PickerStart) {
    if (log) {
      setPickedStart(picks)
      setDialog('replace-with-keep-my-scale')
      return
    }
    startKeepMyScale(picks)
  }

  /**
   * Keep My Scale (ADR 0009, ADR 0011): the Picker's Anchor snapshot (every scored title but the picks) goes into a
   * new log now, naming the split rule chosen in the Picker (ADR 0013); Duels start straight away. The Picker leaves
   * the history, so Back from the Duels goes to Start.
   */
  function startKeepMyScale({ order, anchors, split, ownSplit }: PickerStart) {
    if (!viewer) return
    const log = startKeepMyScaleLog({ seed: newSeed(), userId: viewer.id, mediaType, format: viewer.scoreFormat, anchors, ids: order, split })
    const saved = duelLog.save(log)
    if (!saved.ok) return reportFailure(saved, couldNotStart)
    // The titles left unsettled last time are offered no more, whether or not they were picked again (#66).
    unsettledStore?.clear()
    // Only a choice the user made themselves is remembered, never one that followed the recommendation (ADR 0013).
    if (ownSplit) createSplitChoiceStore(localStorage, viewer.id).remember(ownSplit)
    window.history.replaceState({ screen: 'start' }, '')
    goTo('ranking')
  }

  /**
   * Runs only after the user confirmed in the Replace dialog (#46): the saved Scores / Full Ranking Ranking is thrown
   * away and a Keep My Scale one starts on the titles picked in the Picker.
   */
  function replaceWithKeepMyScale() {
    if (!rankingKey || !pickedStart) return
    deleteDuelLog(localStorage, rankingKey)
    imports.discard(rankingKey)
    setDialog(null)
    setNotice(null)
    openRanking(rankingKey, false)
    setPickedGoal(KEEP_MY_SCALE)
    setPickedStart(null)
    startKeepMyScale(pickedStart)
    showToast(`Your ${MEDIA_LABEL[mediaType]} Ranking was replaced by Keep My Scale.`)
  }

  /**
   * A Keep My Scale Ranking ends with its Import (ADR 0010): of it only the titles left unsettled are kept, without
   * their answers, for the next Picker to offer (ADR 0011, #66). The Import screen stays on its summary; the titles it
   * wrote are Anchors for the next Ranking.
   */
  function endKeepMyScale(key: RankingKey) {
    const ended = duelLog.latest()?.ranking
    if (!ended || !isKeepMyScale(ended)) return
    try {
      createUnsettledStore(localStorage, key).remember(ended)
    } catch (e) {
      // Not the Duel log, but the same refusal: the same banner says so.
      if (!(e instanceof SaveError)) throw e
      reportFailure({ reason: 'save-refused' })
    }
    deleteDuelLog(localStorage, key)
    imports.discard(key)
    duelLog.close()
    setRankingUi(leftRanking)
  }

  /** Runs only after the user confirmed in the Start over dialog. */
  function startOver() {
    if (!rankingKey) return
    deleteDuelLog(localStorage, rankingKey)
    imports.discard(rankingKey)
    setDialog(null)
    setNotice(null)
    openRanking(rankingKey, false)
    goTo('start')
    showToast(`Your ${MEDIA_LABEL[mediaType]} Ranking was thrown away.`)
  }

  function switchMediaType(type: MediaType) {
    if (!viewer || type === mediaType) return
    saveLastMediaType(localStorage, viewer.id, type)
    const inRankingNow = screen === 'ranking'
    if (!openRanking({ userId: viewer.id, mediaType: type }, inRankingNow) && inRankingNow) goTo('start')
  }

  /** Catch-up, from the menu or the mochi on Start: anime only, whichever Ranking is open. */
  function openCatchUp() {
    if (screen !== 'catchup') goTo('catchup')
    void catchUp.open()
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
      openPicker({ from: 'catch-up' }, 'ANIME')
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
          savePoolSettings(localStorage, { userId: viewer.id, mediaType }, { statuses: next })
          setStatuses(next)
        },
        onLogout: () => setDialog('logout'),
        onStartRoughSort: savedBroken ? undefined : startOrContinue,
        onChooseTitles: savedBroken ? undefined : () => openPicker({ from: 'start' }),
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
    const key: RankingKey = { userId: viewerId, mediaType: 'ANIME' }
    const statuses = loadPoolSettings(localStorage, key)?.statuses ?? DEFAULT_STATUSES
    const anime = { list: animeList ?? null, statuses, scoreFormat: viewerFormat, titleLanguage, picked: null }
    try {
      const saved = loadDuelLog(localStorage, key)
      return startView({ ...anime, saved: saved && { log: saved, ranking: replay(saved) }, savedBroken: false })
    } catch {
      return startView({ ...anime, saved: null, savedBroken: true })
    }
  }, [mediaType, viewerId, viewerFormat, titleLanguage, animeList])
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

  /** Renders the screen `shownScreen` answered with. */
  function screenOf(shown: Shown) {
    switch (shown.kind) {
      case 'start':
        return (
          <StartScreen
            form={form}
            covers={pool?.titles ?? list?.filter(isWatched) ?? trending}
            loggingIn={Boolean(token) && !viewer && !notice}
            onLogin={loginRedirect}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        )
      case 'picker':
        return (
          <PickerScreen
            key={mediaType}
            list={list ?? []} // the Picker shows only once the list is loaded
            scoreFormat={shown.viewer.scoreFormat}
            titleLanguage={shown.viewer.titleLanguage}
            mediaType={mediaType}
            initialPicks={startingPicks(list ?? [], shown.viewer.scoreFormat, pickerWayIn, pickAgain)}
            rememberedSplit={createSplitChoiceStore(localStorage, shown.viewer.id).choice()}
            onBack={() => window.history.back()}
            onConfirm={confirmPicks}
          />
        )
      case 'catch-up':
        return (
          <CatchUpScreen
            view={catchUp.view}
            queue={catchUp.queue}
            batchExtra={
              catchUp.startingEraLabel !== null && (
                <StartingEraChip label={catchUp.startingEraLabel} onChange={catchUp.changeStartingEra} />
              )
            }
            eraQuestion={
              catchUp.view.phase === 'era' && (
                <StartingEraQuestion
                  popular={catchUp.view.popular}
                  answer={catchUp.view.answer}
                  titleLanguage={shown.viewer.titleLanguage}
                  onAnswer={catchUp.answerStartingEra}
                />
              )
            }
            titleLanguage={shown.viewer.titleLanguage}
            onBack={() => window.history.back()}
            onReload={catchUp.open}
            onCycle={catchUp.cycle}
            onMark={catchUp.mark}
            onSave={catchUp.saveAndNext}
            onRetryWrites={catchUp.retryWrites}
            headerAction={offer && <ExitOfferButton offer={offer} onTake={takeExitOffer} />}
          />
        )
      case 'import': {
        const { importing } = shown
        // A Keep My Scale Ranking is gone once its Import finished (ADR 0010); the summary still shows.
        const ended = shown.ranking === null
        return (
          <ImportScreen
            stage={importing.stage}
            state={importing.state}
            status={importing.status}
            writtenBefore={importing.writtenBefore}
            entries={entries}
            titleLanguage={shown.viewer.titleLanguage}
            format={importing.state.format}
            onConfirm={imports.confirm}
            onStop={imports.stop}
            onResume={() => void imports.resume().then(showResumed)}
            onRetry={() => void imports.retry().then(showResumed)}
            onBack={() => goTo('preview')}
            onStart={() => goTo('start')}
            mediaType={mediaType}
            ended={ended}
          />
        )
      }
      case 'preview': {
        const { ranking } = shown
        return (
          <PreviewScreen
            state={ranking}
            preview={previewRead!} // read whenever Preview shows
            entries={entries}
            oldScores={shown.oldScores}
            titleLanguage={shown.viewer.titleLanguage}
            format={shown.viewer.scoreFormat}
            settings={shown.scoring}
            onSettings={changeScoring}
            onSwitchGoal={isKeepMyScale(ranking) ? undefined : requestSortGoal}
            onRefine={ranking.prompt.kind === 'all-complete' ? undefined : refineFromPreview}
            overrides={ticks}
            onTick={imports.tick}
            onImport={imports.importing?.stage === 'running' ? undefined : () => imports.planImport() && goTo('import')}
            onRerank={(id) => fixFromPreview(id, 'Re-ranking', answer({ type: 'rerank-requested', id }))}
            onMove={isKeepMyScale(ranking) ? undefined : (id) => patchRankingUi({ previewMoving: id })}
            onBringBack={(id) => fixFromPreview(id, 'Bringing back', answer({ type: 'unforgotten', id }))}
          />
        )
      }
      default:
        return rankingScreen(shown)
    }
  }

  /** The Ranking screen: the screen for the engine's next prompt, or the Split screen or the last check over it. */
  function rankingScreen(shown: RankingShown) {
    const state = shown.ranking
    const titleLanguage = shown.viewer.titleLanguage
    const shared = { state, entries, titleLanguage, mediaType, onUndo: () => answer({ type: 'undo' }) }
    // Keep My Scale: every settled picked title can be imported before the rest are (ADR 0010).
    const settled = state.keepMyScale?.titles.filter((t) => t.settled).length ?? 0
    const early = settled > 0 ? { settled, onOpen: list && !imports.openingPreview ? openPreview : undefined } : undefined
    switch (shown.kind) {
      case 'split': {
        const { band, lastCheckNext } = shown
        return (
          <SplitScreen
            key={band}
            state={state}
            band={band}
            entries={entries}
            titleLanguage={titleLanguage}
            onSplit={(event) => {
              patchRankingUi({ splitView: { band } })
              answer(event)
            }}
            onSkip={() => {
              setRankingUi((s) => splitSkipped(s, band))
              showToast(<>Skipped. {BAND_UI[band].label} stays one Band</>)
            }}
            // The last check comes before any Duel, so the Band choice comes after it, not straight away.
            nextStep={lastCheckNext ? 'last-check' : 'duels'}
            onClose={() => {
              patchRankingUi({ splitView: null })
              // "Start Duels in Loved › Best": the split Band is chosen, so its Duels come next.
              if (!lastCheckNext && state.bands[band].subBands) chooseBand(band)
            }}
          />
        )
      }
      case 'last-check':
        return (
          <BoardScreen
            state={state}
            entries={entries}
            titleLanguage={titleLanguage}
            heading="Last check"
            hint="Moves are free until your first Duel. After that, moving a title costs Duels."
            mainLabel="Continue →"
            onMain={continueFromLastCheck}
            onMove={moveTitle}
            onUndo={shared.onUndo}
          />
        )
      case 'board': {
        const { done, total } = state.progress.roughSort
        const placed = state.board.bands.reduce((sum, band) => sum + band.titles.length, 0)
        return (
          <BoardScreen
            state={state}
            entries={entries}
            titleLanguage={titleLanguage}
            heading="Board"
            hint={`${count(placed, 'title')} ${placed === 1 ? 'has' : 'have'} a Band. Drag a title to another Band.`}
            mainLabel={
              <>
                ← Back to Rough Sort<span className="hide-m"> · {total - done} left</span>
              </>
            }
            onMain={() => goTo('ranking')}
            onMove={moveTitle}
            onUndo={shared.onUndo}
          />
        )
      }
      case 'rough-sort': {
        const { prompt } = shown
        return (
          <RoughSortScreen
            {...shared}
            key={prompt.id}
            id={prompt.id}
            onBand={(band, sub) => answer(withSub({ type: 'band-assigned', id: prompt.id, band }, sub))}
            onForget={() => answer({ type: 'forgotten', id: prompt.id })}
            onBoard={state.board.open ? openBoard : undefined}
          />
        )
      }
      case 'band-choice': {
        const { prompt } = shown
        return (
          <BandChoiceScreen
            key={`${state.bandChoice?.finished ?? 'none'}-${state.bandChoice?.next ?? prompt.band}`}
            state={state}
            entries={entries}
            titleLanguage={titleLanguage}
            finished={state.bandChoice?.finished ?? null}
            next={state.bandChoice?.next ?? prompt.band}
            onChoose={chooseBand}
            onUndo={shared.onUndo}
            onBoard={state.board.open ? openBoard : undefined}
          />
        )
      }
      case 'duel': {
        const { prompt } = shown
        // Against an Anchor (Keep My Scale, ADR 0009): no Band to choose, nothing to move.
        const inBand = prompt.kind === 'duel'
        const fixing = previewFix?.id === prompt.a ? `${previewFix.verb}: ${nameOf(prompt.a)}` : undefined
        return (
          <DuelScreen
            {...shared}
            prompt={prompt}
            onChooseBand={inBand ? () => goTo('bands') : undefined}
            onPick={(winner) => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: winner === prompt.a ? 'a' : 'b' })}
            onTie={() => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'tie' })}
            onForget={(id) => answer({ type: 'forgotten', id })}
            onMove={inBand ? moveTitle : undefined}
            note={fixing ?? (inBand && prompt.refine ? 'Refine' : undefined)}
            early={early}
          />
        )
      }
      case 'closer-to': {
        // Keep My Scale (#48): which of the two scores the title sits between is it closer to.
        const { prompt } = shown
        return (
          <CloserToScreen
            key={prompt.id}
            state={state}
            prompt={prompt}
            entries={entries}
            titleLanguage={titleLanguage}
            onPick={(level) => answer({ type: 'closer-to-answered', id: prompt.id, level })}
            onUndo={shared.onUndo}
            early={early}
          />
        )
      }
      case 'complete':
        return <CompleteScreen {...shared} onScore={list && !imports.openingPreview ? openPreview : undefined} />
    }
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
      {screenOf(shown)}
      {shown.kind === 'preview' && previewMoving !== null && (
        <MoveSheet
          state={shown.ranking}
          id={previewMoving}
          entries={entries}
          titleLanguage={shown.viewer.titleLanguage}
          onClose={() => patchRankingUi({ previewMoving: null })}
          onMove={(band, sub) => {
            const id = previewMoving
            patchRankingUi({ previewMoving: null })
            fixFromPreview(id, 'Moving', moveTitle(id, band, sub))
          }}
        />
      )}
      {viewer && !dialog && previewMoving === null && <CommandPalette items={menuItems} />}
      {dialog === 'logout' && (
        <LogoutDialog
          onCancel={() => setDialog(null)}
          onConfirm={(deleteProgress) => {
            setDialog(null)
            endSession(deleteProgress)
          }}
        />
      )}
      {dialog === 'restore' && viewer && (
        <RestoreDialog
          userId={viewer.id}
          userName={viewer.name}
          mediaType={mediaType}
          replacesProgress={hasProgress}
          onRestore={restore}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'full-ranking' && ranking && (
        <FullRankingDialog
          extraDuels={fullRankingExtra(ranking)}
          finerSteps={viewerFormat !== undefined && hasHumanStep(viewerFormat)}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            applySortGoal('full-ranking')
          }}
        />
      )}
      {dialog === 'clear-passed' && (
        <ClearPassedDialog
          hidden={passedHidden}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            catchUp.clearPassed()
            showToast('Catch-up’s Passed list is cleared')
          }}
        />
      )}
      {dialog === 'replace-with-keep-my-scale' && viewer && (
        <ReplaceWithKeepMyScaleDialog
          mediaType={mediaType}
          saved={ranking && log ? { goal: goalOf(ranking), duels: answeredDuels(log) } : null}
          onConfirm={replaceWithKeepMyScale}
          onSaveBackup={log ? saveBackup : undefined}
          onCancel={() => {
            setDialog(null)
            setPickedStart(null)
          }}
        />
      )}
      {dialog === 'pick-again' && unsettledStore && (
        <PickAgainDialog
          left={unsettledStore.titles(list ?? []).length}
          onPickAgain={() => enterPicker(unsettledStore.titles(list ?? []))}
          onSkip={() => enterPicker([])}
        />
      )}
      {dialog === 'start-over' && viewer && (
        <StartOverDialog
          mediaType={mediaType}
          counts={ranking && log ? { roughSort: ranking.progress.roughSort.done, duels: answeredDuels(log) } : null}
          onConfirm={startOver}
          onSaveBackup={log ? saveBackup : undefined}
          onCancel={() => setDialog(null)}
        />
      )}
    </Shell>
  )
}
