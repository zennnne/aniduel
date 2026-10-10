// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { AniListError, createAniListGateway, trendingCovers } from '../anilist/gateway.ts'
import type { Cover, ListEntry, ListStatus, MediaType, TitleLanguage, Viewer } from '../anilist/types.ts'
import { authorizeUrl, logout, restoreSession } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import { createBackup, restoreBackup, type Backup } from '../persistence/backup.ts'
import { browserClock } from '../clock.ts'
import { retryFailed } from '../import/importState.ts'
import { createRequestLimiter } from '../writes/limiter.ts'
import {
  deleteDuelLog,
  loadDuelLog,
  loadLastMediaType,
  loadPoolSettings,
  loadScoringSettings,
  saveLastMediaType,
  savePoolSettings,
  type RankingKey,
} from '../persistence/progress.ts'
import { DEFAULT_STATUSES, OFFERED_STATUSES, buildPool, estimateDuels, roughSortOrder } from '../pool/pool.ts'
import { newTitlesInLog, syncEvents } from '../pool/sync.ts'
import { anchorsOf, estimateNewTitlesDuels, newTitlesEligibility, newTitlesList } from '../pool/anchors.ts'
import {
  answeredDuels,
  appendEvent,
  promptedTitle,
  replay,
  startLog,
  startNewTitlesLog,
  withSub,
  type BandIndex,
  type LogEvent,
  type RankingState,
  type SortGoal,
  type SubBandIndex,
  type SwitchableGoal,
} from '../ranking/engine.ts'
import { duelsFromBands, fullRankingExtra } from '../ranking/estimate.ts'
import { planFromScores } from '../ranking/fromScores.ts'
import { previewOpen } from '../ranking/preview.ts'
import { defaultSettings, scoringFor, type ScoringSettings } from '../ranking/scoring.ts'
import { defaultSortGoal, goalOf, isNewTitles, switchGoalEvents } from '../ranking/sortGoal.ts'
import { autoOfferDue, splitOffers } from '../ranking/split.ts'
import { BAND_UI } from './bands.ts'
import { aniListCandidateSource } from '../catchup/suggestionCandidates.ts'
import { createPassedStore } from '../catchup/passed.ts'
import { BandChoiceScreen } from './bandchoice/BandChoiceScreen.tsx'
import { isNearEmpty, startSign, watchedCount } from '../catchup/entry.ts'
import { exitOffer, type ExitOffer } from '../catchup/exitOffer.ts'
import { CatchUpScreen } from './catchup/CatchUpScreen.tsx'
import { StartingEraChip, StartingEraQuestion } from './catchup/StartingEraQuestion.tsx'
import { ClearPassedDialog } from './catchup/ClearPassedDialog.tsx'
import { ExitOfferButton } from './catchup/ExitOfferButton.tsx'
import { useCatchUp } from './catchup/useCatchUp.ts'
import { BoardScreen } from './board/BoardScreen.tsx'
import { lastCheckDue } from './board/lastCheck.ts'
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
import { ReplaceWithNewTitlesDialog, RestoreDialog, StartOverDialog } from './menu/BackupDialogs.tsx'
import { ImportScreen } from './import/ImportScreen.tsx'
import { useImport } from './import/useImport.ts'
import { useWriteQueue } from './useWriteQueue.ts'
import { MEDIA_LABEL, count, titleName } from './meta.ts'
import { PreviewScreen } from './preview/PreviewScreen.tsx'
import { SCORE_FORMAT_LABEL } from './preview/scoreFormat.ts'
import { RankingSidebar } from './RankingSidebar.tsx'
import { RoughSortScreen } from './roughsort/RoughSortScreen.tsx'
import { Shell, type Notice } from './Shell.tsx'
import { StartScreen } from './start/StartScreen.tsx'
import { useTheme } from './theme.ts'
import { useDuelLog } from './useDuelLog.ts'

/**
 * 'bands' = the Band choice, opened by going Back from a Duel or from the menu. 'board' = the Board, opened from
 * Rough Sort while it is open; otherwise the Ranking screen shows. The last-check Board after Rough Sort
 * is not a screen of its own: the Ranking screen shows it until the user continues.
 */
type Screen = 'start' | 'ranking' | 'bands' | 'board' | 'preview' | 'import' | 'catchup'
const SCREENS: readonly Screen[] = ['start', 'ranking', 'bands', 'board', 'preview', 'import', 'catchup']

type DialogName = 'logout' | 'restore' | 'start-over' | 'full-ranking' | 'clear-passed' | 'replace-with-new-titles'

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

export function App() {
  const { theme, toggleTheme } = useTheme()
  const [token, setToken] = useState<string | null>(() =>
    restoreSession({ location: window.location, history: window.history, storage: localStorage }),
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
  const [splitView, setSplitView] = useState<{ band: BandIndex } | null>(null)
  // Bands whose split offer was turned down ("Keep it as it is") in this session.
  const [skippedSplits, setSkippedSplits] = useState<readonly BandIndex[]>([])
  // The user pressed Continue on the last-check Board. Session UI state only, never a log event.
  const [lastCheckContinued, setLastCheckContinued] = useState(false)
  // A new object per toast, so showing the same message twice restarts its timer.
  const [toast, setToast] = useState<{ message: ReactNode } | null>(null)
  const [openingPreview, setOpeningPreview] = useState(false)
  // ADR 0003: Preview only after a fresh Viewer check in this Ranking session (openPreview, or an Import resume).
  const [previewChecked, setPreviewChecked] = useState(false)
  // A fix started from Preview (#11): its Duels run on the Ranking screen, then Preview opens again.
  const [previewFix, setPreviewFix] = useState<{ id: number; verb: string } | null>(null)
  // "Go to Duels →" on Preview's unsettled card (#29): once every score is settled again, Preview opens again.
  const [refining, setRefining] = useState(false)
  // The title whose Move sheet is open over Preview.
  const [previewMoving, setPreviewMoving] = useState<number | null>(null)
  // The Sort Goal the user picked on Start for a new Ranking (#28), or null while they haven't touched it and it
  // follows the Pool size (#38). A saved Ranking's goal lives in its log.
  const [pickedGoal, setPickedGoal] = useState<SortGoal | null>(null)

  const gateway = useMemo(() => (token ? createAniListGateway({ fetch: window.fetch.bind(window), token }) : null), [token])
  // The write queue's requests and Catch-up's reads take turns in one limiter, so together they keep to AniList's rate limit.
  const limiter = useMemo(() => (token ? createRequestLimiter(browserClock) : null), [token])
  const candidateSource = useMemo(
    () => (token && limiter ? aniListCandidateSource({ fetch: window.fetch.bind(window), token, clock: browserClock, limiter }) : null),
    [token, limiter],
  )
  const viewerId = viewer?.id ?? null
  // One write queue for Import's scores and Catch-up's statuses.
  const writes = useWriteQueue({ storage: localStorage, gateway, userId: viewerId, limiter, onError: handleGatewayError })
  // The open Ranking's user and Media Type: the key everything saved for it lives under.
  const rankingKey: RankingKey | null = viewer ? { userId: viewer.id, mediaType } : null

  const list = lists[mediaType]
  // The Pool's estimate is for Scores with the Score Format's defaults (ADR 0007); Full Ranking's is worked out below.
  const viewerFormat = viewer ? viewer.scoreFormat : null
  // Score New Titles (ADR 0009): the Anchors a new Ranking would snapshot, and whether there are enough of them.
  const anchors = useMemo(() => (list && viewerFormat ? anchorsOf(list, viewerFormat) : null), [list, viewerFormat])
  const eligibility = useMemo(() => (anchors ? newTitlesEligibility(anchors) : null), [anchors])
  // A New Titles pick on Start stops counting once it isn't eligible (e.g. on another Media Type).
  const newTitlesPicked = pickedGoal === 'score-new-titles' && eligibility?.eligible !== false
  // Catch-up's exit offer (#52) asks the same of the anime list, whichever Media Type is selected.
  const animeList = lists.ANIME
  const animeNewTitlesEligible = useMemo(
    () => (animeList && viewerFormat ? newTitlesEligibility(anchorsOf(animeList, viewerFormat)).eligible : null),
    [animeList, viewerFormat],
  )
  // A saved Score New Titles Ranking's Anchors and Pool; null for any other Ranking.
  const savedNewTitles = useMemo(() => (log ? newTitlesInLog(log) : null), [log])
  const onNewTitles = ranking ? isNewTitles(ranking) : newTitlesPicked
  // Its Pool is the titles without a score (and the saved Ranking's new titles), never an Anchor.
  const poolList = useMemo(() => (list && onNewTitles ? newTitlesList(list, savedNewTitles) : list), [list, onNewTitles, savedNewTitles])
  const pool = useMemo(
    () =>
      poolList
        ? buildPool(poolList, statuses, viewerFormat ? { format: viewerFormat, settings: defaultSettings(viewerFormat, 'whole') } : undefined)
        : null,
    [poolList, statuses, viewerFormat],
  )
  // The Sort Goal a new Ranking starts on: the user's pick, else the default for the Pool size (ADR 0007, V3 amendment).
  const newGoal: SortGoal = (pickedGoal === 'score-new-titles' && !newTitlesPicked ? null : pickedGoal) ?? defaultSortGoal(pool?.titles.length ?? 0)
  const entries = useMemo(() => new Map((list ?? []).map((e) => [e.mediaId, e])), [list])
  const oldScores = useMemo(() => new Map((pool?.titles ?? []).map((e) => [e.mediaId, e.oldScore100])), [pool])
  const titleLanguage = viewer?.titleLanguage
  // A new Ranking's Rough Sort order, and the Rough Sort from Scores plan over it (ADR 0008).
  const startOrder = useMemo(
    () => (pool && titleLanguage ? roughSortOrder(pool.titles, titleLanguage) : null),
    [pool, titleLanguage],
  )
  const scoresPlan = useMemo(
    () => (startOrder ? planFromScores(startOrder.map((id) => ({ id, score100: oldScores.get(id) ?? 0 }))) : null),
    [startOrder, oldScores],
  )

  const imports = useImport({
    storage: localStorage,
    gateway,
    queue: writes.queue,
    viewer,
    setViewer,
    key: rankingKey,
    latestLog: duelLog.latest,
    append: duelLog.append,
    oldScores: pool ? oldScores : null,
    name: (id, language) => titleName(entries.get(id), id, language),
    onViewerChecked: () => setPreviewChecked(true),
    setNotice,
    onImportScreen: screen === 'import',
    goTo,
    onGatewayError: handleGatewayError,
    onWritten: (key, written) =>
      // Preview should show the scores AniList has now.
      setLists((prev) => {
        const current = prev[key.mediaType]
        if (!current) return prev
        return { ...prev, [key.mediaType]: current.map((e) => (written.has(e.mediaId) ? { ...e, oldScore100: written.get(e.mediaId)! } : e)) }
      }),
  })

  const passedStore = useMemo(() => (viewerId === null ? undefined : createPassedStore(localStorage, viewerId)), [viewerId])
  const catchUp = useCatchUp({
    storage: localStorage,
    passedStore,
    gateway,
    queue: writes.queue,
    queueSnapshot: writes.snapshot,
    source: candidateSource,
    viewer,
    onGatewayError: handleGatewayError,
    // Titles Catch-up added can join the anime Pool: read the list again, which syncs a saved Ranking.
    onWritten: () => refreshList('ANIME'),
  })

  const needTrending = !token && trending.length === 0
  useEffect(() => {
    if (!needTrending) return
    let cancelled = false
    trendingCovers({ fetch: window.fetch.bind(window) }, COLLAGE_TILES)
      .then((covers) => !cancelled && setTrending(covers))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [needTrending])

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
    setSplitView(null)
    setSkippedSplits([])
    setLastCheckContinued(false)
    setPreviewChecked(false)
    imports.open(key)
    setPreviewFix(null)
    setRefining(false)
    setPreviewMoving(null)
    setStatuses(loadPoolSettings(localStorage, key)?.statuses ?? DEFAULT_STATUSES)
    try {
      const saved = loadDuelLog(localStorage, key)
      duelLog.show(saved) // replays first: a log the engine can't replay throws before anything from it shows
      setSavedBroken(false)
      if (saved && resume) goTo('ranking')
      return saved !== null
    } catch (e) {
      duelLog.show(null)
      setSavedBroken(true)
      setNotice({
        tone: 'error',
        message: `Your saved ${MEDIA_LABEL[key.mediaType]} progress in this browser can't be used (${e instanceof Error ? e.message : 'unknown error'}). It was left untouched.`,
        action: { label: 'Restore a Backup', onClick: () => setDialog('restore') },
      })
      return false
    }
  }

  function endSession(deleteProgress: boolean) {
    writes.stop() // before the user's progress is deleted, so nothing written after is saved again
    catchUp.close()
    logout(localStorage, { userId: viewer?.id ?? null, deleteProgress })
    setToken(null)
    setViewer(null)
    setLists({})
    setStatuses(DEFAULT_STATUSES)
    setPreviewChecked(false)
    duelLog.show(null)
    setSavedBroken(false)
    setSplitView(null)
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

  // A freshly fetched list is the moment to sync a saved Ranking (resume, also months after an Import).
  const onListFetched = useEffectEvent((type: MediaType, fetched: ListEntry[]) => {
    setLists((prev) => ({ ...prev, [type]: fetched }))
    const summary = syncPool(type, fetched, statuses)
    if (summary) showToast(summary)
  })

  /** Reads an already-loaded list again (after Catch-up wrote to it), syncing a saved Ranking like a first fetch. */
  function refreshList(type: MediaType) {
    if (!gateway || !viewer) return
    if (!lists[type]) {
      // A first read still in flight may have left before the write: start it again.
      setRetries((n) => n + 1)
      return
    }
    gateway.mediaList({ userId: viewer.id, type, statuses: OFFERED_STATUSES }).then(
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
    // Fetch every offered status once, so each chip can show its count and toggling needs no refetch.
    gateway.mediaList({ userId: viewer.id, type: listToFetch, statuses: OFFERED_STATUSES }).then(
      (list) => !cancelled && onListFetched(listToFetch, list),
      (e: unknown) => !cancelled && onGatewayError(e),
    )
    return () => {
      cancelled = true
    }
  }, [gateway, viewer, listToFetch, retries])

  // Band split (ADR 0006). Offered on its own after Rough Sort (also after a sync added titles), before the next
  // Duel answer, for each Band that qualifies and wasn't skipped in this session; later only from the menu. `splitView` pins the Split screen open
  // (from the menu, or through its "done" step, when the Band no longer qualifies).
  const offers = ranking ? splitOffers(ranking) : []
  const autoOffer =
    ranking?.prompt.kind === 'duel' && log && autoOfferDue(log) ? offers.find((band) => !skippedSplits.includes(band)) : undefined
  const splitBand = splitView?.band ?? autoOffer ?? null

  // Back in Rough Sort (Undo, or a sync before the first Duel): finishing it shows the last check again.
  if (lastCheckContinued && ranking?.prompt.kind === 'rough-sort') setLastCheckContinued(false)
  // Rough Sort → split offer → last check → Band choice → Duels.
  const lastCheck = ranking ? lastCheckDue(ranking, lastCheckContinued) : false

  /** The Board's entry points (Rough Sort pill, Band choice pill, menu) while it is open: before the first Duel answer. */
  function openBoard() {
    if (!ranking?.board.open) return
    if (ranking.prompt.kind === 'rough-sort') goTo('board')
    else setLastCheckContinued(false)
  }

  /** "Continue →" on the last check: the Band choice comes next. */
  function continueFromLastCheck() {
    setLastCheckContinued(true)
    if (ranking?.prompt.kind === 'duel' && screen !== 'bands') goTo('bands')
  }

  /**
   * Sync (#13, ADR 0005): brings the Pool in the log up to date with the fetched list and the chosen statuses.
   * Added titles go to Rough Sort, removed ones leave the Ranking; both are recorded as events Undo can't cross.
   * Runs on resume (once the list arrives), on Continue from Start (the statuses may have changed) and after a
   * Restore. Does nothing without a usable log or a list. Returns what changed, for a toast (null = nothing).
   */
  function syncPool(type: MediaType, fetched: readonly ListEntry[] | undefined, chosen: readonly ListStatus[]): string | null {
    const current = duelLog.latest()
    if (!viewer || !fetched || !current || current.header.mediaType !== type) return null
    const events = syncEvents(current, fetched, chosen, viewer.titleLanguage)
    if (events.length === 0) return null
    try {
      duelLog.append(...events)
    } catch (e) {
      setNotice({
        tone: 'error',
        message: `Your ${MEDIA_LABEL[type]} Pool couldn't be brought up to date (${e instanceof Error ? e.message : 'unknown error'}). Your progress was left untouched.`,
      })
      return null
    }
    const added = events.reduce((sum, e) => sum + (e.type === 'titles-added' ? e.ids.length : 0), 0)
    const removed = events.reduce((sum, e) => sum + (e.type === 'titles-removed' ? e.ids.length : 0), 0)
    // New titles can push a Band over the split threshold again (ADR 0006), so a skipped offer may show again.
    if (added > 0) setSkippedSplits([])
    const joined = current.events.some((e) => e.type === 'anchors-set') ? 'added' : 'added to Rough Sort'
    const changes = [added > 0 && `${count(added, 'title')} ${joined}`, removed > 0 && `${count(removed, 'title')} left the Ranking`]
    return `Pool updated: ${changes.filter(Boolean).join(' · ')}`
  }

  /**
   * Appends one answer, checks it replays, and saves the log before showing the result. Returns the new state, or
   * null if the answer was dropped. Once a fix started from Preview is placed (or undone), Preview opens again; so
   * it does once the Refine Duels started from Preview are all answered.
   */
  function answer(event: LogEvent): RankingState | null {
    let state: RankingState | null
    try {
      state = duelLog.append(event)
    } catch {
      return null // an answer for a prompt that is no longer showing (e.g. a double key press)
    }
    if (!state) return null
    if (previewFix && fixDone(state, previewFix.id)) {
      setPreviewFix(null)
      if (screen !== 'preview') goTo('preview')
    }
    if (refining && state.prompt.kind === 'all-complete') {
      setRefining(false)
      if (screen !== 'preview') goTo('preview')
      showToast(state.newTitles ? 'Every new title has a score' : 'Every score is settled again')
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
    setPreviewFix({ id, verb })
    goTo('ranking')
  }

  /** "Go to Duels →" on Preview (#29): the Refine Duels, from the top Band that has some. */
  function refineFromPreview() {
    const kind = ranking?.prompt.kind
    if (!ranking || (kind !== 'duel' && kind !== 'anchor-duel' && kind !== 'closer-to')) return
    setRefining(true)
    if (ranking.bandChoice) chooseBand(ranking.bandChoice.next)
    else goTo('ranking')
  }

  /**
   * Duels go on in `band` (a split Band starts at its first Sub-band with titles to place). The Band choice gets
   * its own history entry, so Back from the Duel returns to it.
   */
  function chooseBand(band: BandIndex) {
    const current = duelLog.latest()
    const state = current ? replay(current) : null
    if (!state || state.progress.bands[band].done === state.progress.bands[band].total) return
    const alreadyThere = state.prompt.kind === 'duel' && !state.bandChoice && state.prompt.band === band
    if (!alreadyThere) answer({ type: 'band-selected', band })
    if (screen === 'ranking') window.history.replaceState({ screen: 'bands' }, '')
    goTo('ranking')
  }

  /** `fromScores`: the user turned on Rough Sort from Scores (ADR 0008), a new Ranking only. */
  function startOrContinue(fromScores = false) {
    if (!viewer) return
    if (!duelLog.latest()) {
      if (!startOrder) return
      if (newGoal === 'score-new-titles') {
        startNewTitles(startOrder)
        return
      }
      // The new log carries its own Sort Goal and default scoring settings (ADR 0007).
      const started = startLog({ seed: newSeed(), userId: viewer.id, mediaType, ids: startOrder, scoreFormat: viewer.scoreFormat })
      // Full Ranking picked on Start: the same switch as from the menu, before anything is sorted.
      const log = switchGoalEvents(replay(started), null, viewer.scoreFormat, newGoal).reduce(appendEvent, started)
      const plan = fromScores && scoresPlan?.offerable ? scoresPlan : null
      duelLog.save(plan ? appendEvent(log, { type: 'bands-from-scores', bands: plan.bands }) : log)
    } else {
      // The statuses may have changed on Start: titles that now match join, the rest leave.
      const summary = syncPool(mediaType, list, statuses)
      if (summary) showToast(summary)
    }
    goTo('ranking')
  }

  /**
   * Runs `Viewer` again first (spec Auth, ADR 0003): if the Score Format changed since best / worst were
   * chosen, they are converted to the new format, the conversion is appended to the Duel log (ADR 0007), and a
   * blue banner says so. An older log without settings of its own gets them appended too, so Preview reads them
   * from the log.
   */
  function openPreview() {
    if (!gateway || !viewer || openingPreview) return
    setOpeningPreview(true)
    gateway.viewer().then(
      (fresh) => {
        setOpeningPreview(false)
        setViewer(fresh)
        const key = { userId: fresh.id, mediaType }
        const current = duelLog.latest()
        if (!current) return
        const { converted, event } = scoringFor(replay(current), loadScoringSettings(localStorage, key), fresh.scoreFormat)
        if (event) duelLog.append(event)
        if (converted) {
          imports.dropForFormatChange(key)
          // Score New Titles has no best / worst: its scores are the Anchors', shown in the new Score Format.
          const check = isNewTitles(replay(current)) ? 'Check the new scores' : 'Best / Worst were converted. Check them'
          setNotice({
            tone: 'info',
            message: `Your Score Format changed to ${SCORE_FORMAT_LABEL[fresh.scoreFormat]}. ${check} before importing.`,
          })
        }
        setPreviewChecked(true)
        goTo('preview')
      },
      (e: unknown) => {
        setOpeningPreview(false)
        handleGatewayError(e)
      },
    )
  }

  /** Settings changed on Preview go into the Duel log (ADR 0007), so a reload or a Backup gives the same scores. */
  function changeScoring(settings: ScoringSettings) {
    if (!viewer || !duelLog.latest()) return
    duelLog.append({ type: 'scoring-set', format: viewer.scoreFormat, settings })
  }

  /**
   * Switches the open Ranking's Sort Goal (#28, ADR 0007): its settings move to the new goal's Score Step. Every
   * earlier answer still counts. Preview keeps showing the new settings.
   */
  function applySortGoal(goal: SwitchableGoal) {
    const current = duelLog.latest()
    if (!viewer || !current) return
    const key = { userId: viewer.id, mediaType }
    const events = switchGoalEvents(replay(current), loadScoringSettings(localStorage, key), viewer.scoreFormat, goal)
    if (events.length === 0) return
    try {
      duelLog.append(...events)
    } catch (e) {
      setNotice({
        tone: 'error',
        message: `Your Ranking couldn't switch its Sort Goal (${e instanceof Error ? e.message : 'unknown error'}). Your progress was left untouched.`,
      })
      return
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

  /** Score New Titles (ADR 0009): the Anchors are snapshotted into a new log now; Duels start straight away. */
  function startNewTitles(ids: number[]) {
    if (!viewer || !anchors || !eligibility?.eligible) return
    duelLog.save(startNewTitlesLog({ seed: newSeed(), userId: viewer.id, mediaType, format: viewer.scoreFormat, anchors, ids }))
    goTo('ranking')
  }

  /**
   * Runs only after the user confirmed in the Replace dialog (#46): the saved Scores / Full Ranking Ranking is thrown
   * away and a Score New Titles one starts on the unscored titles of the chosen statuses.
   */
  function replaceWithNewTitles() {
    if (!rankingKey || !viewer || !list || !eligibility?.eligible) return
    const ids = roughSortOrder(buildPool(newTitlesList(list, null), statuses).titles, viewer.titleLanguage)
    deleteDuelLog(localStorage, rankingKey)
    imports.discard(rankingKey)
    setDialog(null)
    setNotice(null)
    openRanking(rankingKey, false)
    setPickedGoal('score-new-titles')
    startNewTitles(ids)
    showToast(`Your ${MEDIA_LABEL[mediaType]} Ranking was replaced by Score New Titles.`)
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
    catchUp.open()
  }

  /**
   * Leaving Catch-up through its exit offer: on to Start on anime, with Score New Titles picked, or with no pick so
   * the Sort Goal follows the Pool size (#38). A saved anime Ranking keeps its own Sort Goal either way.
   */
  function takeExitOffer(offer: ExitOffer) {
    switchMediaType('ANIME')
    setPickedGoal(offer.target === 'score-new-titles' ? 'score-new-titles' : null)
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
            setSplitView({ band })
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

  // Start: the saved Ranking's Sort Goal, or the one a new Ranking will start on, and its estimate (#28).
  const shownGoal: SortGoal = ranking ? goalOf(ranking) : newGoal
  const fullPoolDuels = pool ? estimateDuels(pool.titles.length) : null
  // Score New Titles: one search per new title over the Anchor scores (a saved Ranking: its unsettled titles only).
  const newTitlesDuels = ranking?.newTitles
    ? estimateNewTitlesDuels(ranking.progress.ranked.total - ranking.progress.ranked.done, ranking.newTitles.levels.length)
    : pool && eligibility
      ? estimateNewTitlesDuels(pool.titles.length, eligibility.scores)
      : null
  // Start's New Titles button: the titles without a score in the chosen statuses (Score New Titles' own Pool).
  const unscored = useMemo(
    () => (list ? buildPool(newTitlesList(list, savedNewTitles), statuses).titles.length : null),
    [list, savedNewTitles, statuses],
  )
  // With a Scores / Full Ranking Ranking saved, New Titles stays clickable: it asks to replace that Ranking (#46).
  const newTitlesReason = eligibility && !eligibility.eligible ? eligibility.reason : null

  const form = viewer
    ? {
        viewer,
        mediaType,
        statuses,
        pool,
        // A Score New Titles Ranking has no Rough Sort: its progress is the new titles that have a score.
        saved: (ranking?.newTitles ? ranking.progress.ranked : ranking?.progress.roughSort) ?? null,
        // Offered for a new Ranking only.
        scoresPlan: hasProgress ? null : scoresPlan,
        bandDuels: ranking && !onNewTitles ? duelsFromBands(ranking) : null,
        goal: shownGoal,
        onGoal: (goal: SortGoal) => {
          if (!ranking) setPickedGoal(goal)
          else if (goal !== 'score-new-titles') requestSortGoal(goal)
          else if (!isNewTitles(ranking)) setDialog('replace-with-new-titles')
        },
        poolDuels: onNewTitles ? newTitlesDuels : pool && shownGoal === 'scores' ? pool.expectedDuels : fullPoolDuels,
        extraDuels:
          ranking && !onNewTitles
            ? fullRankingExtra(ranking) || null
            : pool && fullPoolDuels !== null && !onNewTitles
              ? fullPoolDuels - pool.expectedDuels
              : null,
        newTitles: {
          count: unscored,
          enabled: newTitlesReason === null && Boolean(eligibility),
          reason: onNewTitles ? null : newTitlesReason,
          anchors: ranking?.newTitles?.anchorCount ?? eligibility?.anchors ?? 0,
        },
        onMediaType: switchMediaType,
        onToggleStatus: (s: ListStatus) => {
          const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]
          savePoolSettings(localStorage, { userId: viewer.id, mediaType }, { statuses: next })
          setStatuses(next)
        },
        onLogout: () => setDialog('logout'),
        onStartRoughSort: savedBroken ? undefined : startOrContinue,
        onRestore: () => setDialog('restore'),
        catchUp: {
          sign: startSign(mediaType, catchUp.queue),
          watched: mediaType === 'ANIME' && list ? watchedCount(list) : null,
          nearEmpty: mediaType === 'ANIME' && list ? isNearEmpty(list) : false,
          onOpen: openCatchUp,
        },
      }
    : null
  const offer = exitOffer({ added: catchUp.added, eligibleForNewTitles: animeNewTitlesEligible })

  // Wait for the list's display data, unless AniList is unreachable: answers still work then, with plain cards.
  const inRanking =
    (screen === 'ranking' || screen === 'bands' || screen === 'board' || screen === 'preview' || screen === 'import') && viewer && ranking && (list || notice)
  const importView = imports.view
  const inImport = screen === 'import' && importView
  // Preview only for a finished Ranking whose old scores are loaded; otherwise the Ranking screen shows. On Scores,
  // Refine Duels left by a settings change keep Preview open: its settled titles can still be imported (#29).
  // Its scoring settings are the log's own (ADR 0007), put there on the Score Format AniList reports by `openPreview`.
  const scoring = ranking?.scoring && viewer && ranking.scoring.format === viewer.scoreFormat ? ranking.scoring.settings : null
  const inPreview = screen === 'preview' && ranking && previewOpen(ranking.prompt) && previewChecked && scoring && pool

  /** The screen for the engine's next prompt: Rough Sort, a Duel, or the finished Ranking. */
  function rankingScreen(state: RankingState, titleLanguage: TitleLanguage) {
    const prompt = state.prompt
    const shared = { state, entries, titleLanguage, mediaType, onUndo: () => answer({ type: 'undo' }) }
    if (splitBand !== null) {
      const band = splitBand
      return (
        <SplitScreen
          key={band}
          state={state}
          band={band}
          entries={entries}
          titleLanguage={titleLanguage}
          onSplit={(event) => {
            setSplitView({ band })
            answer(event)
          }}
          onSkip={() => {
            setSkippedSplits((prev) => [...prev, band])
            setSplitView(null)
            showToast(<>Skipped. {BAND_UI[band].label} stays one Band</>)
          }}
          // The last check comes before any Duel, so the Band choice comes after it, not straight away.
          nextStep={lastCheck ? 'last-check' : 'duels'}
          onClose={() => {
            setSplitView(null)
            // "Start Duels in Loved › Best": the split Band is chosen, so its Duels come next.
            if (!lastCheck && state.bands[band].subBands) chooseBand(band)
          }}
        />
      )
    }
    if (lastCheck) {
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
    }
    switch (prompt.kind) {
      case 'rough-sort': {
        if (screen === 'board' && state.board.open) {
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
      case 'duel':
        if (state.bandChoice || screen === 'bands') {
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
        return (
          <DuelScreen
            {...shared}
            prompt={prompt}
            onChooseBand={() => goTo('bands')}
            onPick={(winner) => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: winner === prompt.a ? 'a' : 'b' })}
            onTie={() => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'tie' })}
            onForget={(id) => answer({ type: 'forgotten', id })}
            onMove={moveTitle}
            note={previewFix?.id === prompt.a ? `${previewFix.verb}: ${nameOf(prompt.a)}` : prompt.refine ? 'Refine' : undefined}
          />
        )
      case 'anchor-duel':
        // Score New Titles (ADR 0009): no Band to choose, nothing to move.
        return (
          <DuelScreen
            {...shared}
            prompt={prompt}
            onPick={(winner) => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: winner === prompt.a ? 'a' : 'b' })}
            onTie={() => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'tie' })}
            onForget={(id) => answer({ type: 'forgotten', id })}
            note={previewFix?.id === prompt.a ? `${previewFix.verb}: ${nameOf(prompt.a)}` : undefined}
          />
        )
      case 'closer-to':
        // Score New Titles (#48): which of the two scores the title sits between is it closer to.
        return (
          <CloserToScreen
            key={prompt.id}
            state={state}
            prompt={prompt}
            entries={entries}
            titleLanguage={titleLanguage}
            onPick={(level) => answer({ type: 'closer-to-answered', id: prompt.id, level })}
            onUndo={shared.onUndo}
          />
        )
      case 'all-complete':
        return <CompleteScreen {...shared} onScore={list && !openingPreview ? openPreview : undefined} />
    }
  }

  return (
    <Shell
      // A cut-off Import (or one with failures) is offered again until it finishes, the plan is dropped, or Start over.
      notice={notice ?? imports.notice(Boolean(list))}
      toast={toast?.message}
      sidebar={
        inRanking ? (
          <RankingSidebar
            viewer={viewer}
            mediaType={mediaType}
            state={ranking}
            entries={entries}
            titleLanguage={viewer.titleLanguage}
            offered={splitBand !== null && !ranking.bands[splitBand].subBands ? [splitBand] : undefined}
            menu={
              <AccountMenu
                name={viewer.name}
                avatarUrl={viewer.avatarUrl}
                detail={`${MEDIA_LABEL[mediaType]} · ${count(ranking.progress.roughSort.total, 'title')}`}
                items={menuItems}
              />
            }
          />
        ) : undefined
      }
    >
      {screen === 'catchup' && viewer ? (
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
                titleLanguage={viewer.titleLanguage}
                onAnswer={catchUp.answerStartingEra}
              />
            )
          }
          titleLanguage={viewer.titleLanguage}
          onBack={() => window.history.back()}
          onReload={catchUp.open}
          onCycle={catchUp.cycle}
          onMark={catchUp.mark}
          onSave={catchUp.saveAndNext}
          onRetryWrites={catchUp.retryWrites}
          headerAction={offer && <ExitOfferButton offer={offer} onTake={takeExitOffer} />}
        />
      ) : inRanking && inImport ? (
        <ImportScreen
          stage={importView.stage}
          state={importView.state}
          status={importView.status}
          writtenBefore={importView.writtenBefore}
          entries={entries}
          titleLanguage={viewer.titleLanguage}
          format={importView.state.format}
          onConfirm={() => void imports.write(importView.state)}
          onStop={imports.stop}
          onResume={() => imports.resume(importView.state)}
          onRetry={() => imports.resume(retryFailed(importView.state))}
          onBack={() => goTo('preview')}
        />
      ) : inRanking && inPreview ? (
        <PreviewScreen
          state={ranking}
          entries={entries}
          oldScores={oldScores}
          titleLanguage={viewer.titleLanguage}
          format={viewer.scoreFormat}
          settings={scoring}
          onSettings={changeScoring}
          onSwitchGoal={isNewTitles(ranking) ? undefined : requestSortGoal}
          onRefine={ranking.prompt.kind === 'all-complete' ? undefined : refineFromPreview}
          overrides={imports.ticks}
          onTick={imports.tick}
          onImport={importView?.stage === 'running' ? undefined : (plan) => imports.plan(plan, scoring)}
          onRerank={(id) => fixFromPreview(id, 'Re-ranking', answer({ type: 'rerank-requested', id }))}
          onMove={isNewTitles(ranking) ? undefined : setPreviewMoving}
          onBringBack={(id) => fixFromPreview(id, 'Bringing back', answer({ type: 'unforgotten', id }))}
        />
      ) : inRanking ? (
        rankingScreen(ranking, viewer.titleLanguage)
      ) : (
        <StartScreen
          form={form}
          covers={pool?.titles ?? list ?? trending}
          loggingIn={Boolean(token) && !viewer && !notice}
          onLogin={loginRedirect}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}
      {inRanking && inPreview && previewMoving !== null && (
        <MoveSheet
          state={ranking}
          id={previewMoving}
          entries={entries}
          titleLanguage={viewer.titleLanguage}
          onClose={() => setPreviewMoving(null)}
          onMove={(band, sub) => {
            const id = previewMoving
            setPreviewMoving(null)
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
      {dialog === 'replace-with-new-titles' && viewer && (
        <ReplaceWithNewTitlesDialog
          mediaType={mediaType}
          saved={ranking && log ? { goal: goalOf(ranking), duels: answeredDuels(log) } : null}
          onConfirm={replaceWithNewTitles}
          onSaveBackup={log ? saveBackup : undefined}
          onCancel={() => setDialog(null)}
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
