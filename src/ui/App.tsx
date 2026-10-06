// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react'
import { AniListError, createAniListGateway, trendingCovers } from '../anilist/gateway.ts'
import type { Cover, ListEntry, ListStatus, MediaType, TitleLanguage, Viewer } from '../anilist/types.ts'
import { authorizeUrl, logout, restoreSession } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import { createBackup, restoreBackup, type Backup } from '../persistence/backup.ts'
import { retryFailed } from '../import/runner.ts'
import {
  deleteDuelLog,
  loadDuelLog,
  loadLastMediaType,
  loadPoolSettings,
  loadScoringFor,
  saveLastMediaType,
  savePoolSettings,
  saveScoringSettings,
  type RankingKey,
} from '../persistence/progress.ts'
import { DEFAULT_STATUSES, OFFERED_STATUSES, buildPool, roughSortOrder } from '../pool/pool.ts'
import { syncEvents } from '../pool/sync.ts'
import {
  answeredDuels,
  appendEvent,
  replay,
  startLog,
  withSub,
  type BandIndex,
  type LogEvent,
  type RankingState,
  type SubBandIndex,
} from '../ranking/engine.ts'
import { duelsFromBands } from '../ranking/estimate.ts'
import { planFromScores } from '../ranking/fromScores.ts'
import type { ScoringSettings } from '../ranking/scoring.ts'
import { autoOfferDue, splitOffers } from '../ranking/split.ts'
import { BAND_UI } from './bands.ts'
import { BandChoiceScreen } from './bandchoice/BandChoiceScreen.tsx'
import { BoardScreen } from './board/BoardScreen.tsx'
import { lastCheckDue } from './board/lastCheck.ts'
import { SplitScreen } from './split/SplitScreen.tsx'
import { CompleteScreen } from './duel/CompleteScreen.tsx'
import { DuelScreen } from './duel/DuelScreen.tsx'
import { Kao, SubPill } from './Kao.tsx'
import { MoveSheet } from './move/MoveSheet.tsx'
import { LogoutDialog } from './LogoutDialog.tsx'
import { AccountMenu, CommandPalette } from './menu/AppMenu.tsx'
import { buildMenuItems } from './menu/buildMenuItems.ts'
import { RestoreDialog, StartOverDialog } from './menu/BackupDialogs.tsx'
import { ImportScreen } from './import/ImportScreen.tsx'
import { useImport } from './import/useImport.ts'
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
 * Rough Sort while it is open (#33); otherwise the Ranking screen shows. The last-check Board after Rough Sort
 * (#34) is not a screen of its own: the Ranking screen shows it until the user continues.
 */
type Screen = 'start' | 'ranking' | 'bands' | 'board' | 'preview' | 'import'
const SCREENS: readonly Screen[] = ['start', 'ranking', 'bands', 'board', 'preview', 'import']

type DialogName = 'logout' | 'restore' | 'start-over'

const TOAST_MS = 4000

/** Tiles in the Start collage. */
const COLLAGE_TILES = 36

function loginRedirect() {
  window.location.assign(authorizeUrl(aniListClientId({ dev: import.meta.env.DEV })))
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
  // The user pressed Continue on the last-check Board (#34). Session UI state only, never a log event.
  const [lastCheckContinued, setLastCheckContinued] = useState(false)
  // A new object per toast, so showing the same message twice restarts its timer.
  const [toast, setToast] = useState<{ message: ReactNode } | null>(null)
  // Best / worst / Distribution for the Score Format AniList reported when Preview opened; null until then.
  const [scoring, setScoring] = useState<ScoringSettings | null>(null)
  const [openingPreview, setOpeningPreview] = useState(false)
  // A fix started from Preview (#11): its Duels run on the Ranking screen, then Preview opens again.
  const [previewFix, setPreviewFix] = useState<{ id: number; verb: string } | null>(null)
  // The title whose Move sheet is open over Preview.
  const [previewMoving, setPreviewMoving] = useState<number | null>(null)

  const gateway = useMemo(() => (token ? createAniListGateway({ fetch: window.fetch.bind(window), token }) : null), [token])
  // The open Ranking's user and Media Type: the key everything saved for it lives under.
  const rankingKey: RankingKey | null = viewer ? { userId: viewer.id, mediaType } : null

  const list = lists[mediaType]
  const pool = useMemo(() => (list ? buildPool(list, statuses) : null), [list, statuses])
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
    viewer,
    setViewer,
    key: rankingKey,
    latestLog: duelLog.latest,
    oldScores: pool ? oldScores : null,
    setScoring,
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
    setScoring(null)
    imports.open(key)
    setPreviewFix(null)
    setPreviewMoving(null)
    setStatuses(loadPoolSettings(localStorage, key)?.statuses ?? DEFAULT_STATUSES)
    try {
      const saved = loadDuelLog(localStorage, key)
      if (saved) replay(saved) // refuse a log the engine can't replay before showing anything from it
      duelLog.show(saved)
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
    logout(localStorage, { userId: viewer?.id ?? null, deleteProgress })
    setToken(null)
    setViewer(null)
    setLists({})
    setStatuses(DEFAULT_STATUSES)
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

  useEffect(() => {
    if (!gateway || !viewer || lists[mediaType]) return
    let cancelled = false
    // Fetch every offered status once, so each chip can show its count and toggling needs no refetch.
    gateway.mediaList({ userId: viewer.id, type: mediaType, statuses: OFFERED_STATUSES }).then(
      (list) => !cancelled && onListFetched(mediaType, list),
      (e: unknown) => !cancelled && onGatewayError(e),
    )
    return () => {
      cancelled = true
    }
  }, [gateway, viewer, mediaType, lists, retries])

  // Band split (ADR 0006). Offered on its own after Rough Sort (also after a sync added titles), before the next
  // Duel answer, for each Band that qualifies and wasn't skipped in this session; later only from the menu. `splitView` pins the Split screen open
  // (from the menu, or through its "done" step, when the Band no longer qualifies).
  const offers = ranking ? splitOffers(ranking) : []
  const autoOffer =
    ranking?.prompt.kind === 'duel' && log && autoOfferDue(log) ? offers.find((band) => !skippedSplits.includes(band)) : undefined
  const splitBand = splitView?.band ?? autoOffer ?? null

  // Back in Rough Sort (Undo, or a sync before the first Duel): finishing it shows the last check again (#34).
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
    const changes = [added > 0 && `${count(added, 'title')} added to Rough Sort`, removed > 0 && `${count(removed, 'title')} left the Ranking`]
    return `Pool updated: ${changes.filter(Boolean).join(' · ')}`
  }

  /**
   * Appends one answer, checks it replays, and saves the log before showing the result. Returns the new state, or
   * null if the answer was dropped. Once a fix started from Preview is placed (or undone), Preview opens again.
   */
  function answer(event: LogEvent): RankingState | null {
    let state: RankingState | null
    try {
      state = duelLog.append(event)
    } catch {
      return null // an answer for a prompt that is no longer showing (e.g. a double key press)
    }
    if (!state) return null
    if (previewFix && state.prompt.kind === 'all-complete') {
      setPreviewFix(null)
      if (screen !== 'preview') goTo('preview')
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
    if (state.prompt.kind === 'all-complete') {
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

  /**
   * Duels go on in `band` (a split Band starts at its first Sub-band with titles to place). The Band choice gets
   * its own history entry, so Back from the Duel returns to it.
   */
  function chooseBand(band: BandIndex) {
    const current = duelLog.latest()
    const state = current ? replay(current) : null
    if (!state || state.bands[band].unplaced.length === 0) return
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
      const log = startLog({ seed: newSeed(), userId: viewer.id, mediaType, ids: startOrder })
      const plan = fromScores && scoresPlan?.offer ? scoresPlan : null
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
   * chosen, they are converted to the new format and a blue banner says so.
   */
  function openPreview() {
    if (!gateway || !viewer || openingPreview) return
    setOpeningPreview(true)
    gateway.viewer().then(
      (fresh) => {
        setOpeningPreview(false)
        setViewer(fresh)
        const key = { userId: fresh.id, mediaType }
        const { settings, converted } = loadScoringFor(localStorage, key, fresh.scoreFormat)
        if (converted) {
          imports.dropForFormatChange(key)
          setNotice({
            tone: 'info',
            message: `Your Score Format changed to ${SCORE_FORMAT_LABEL[fresh.scoreFormat]}. Best / Worst were converted. Check them before importing.`,
          })
        }
        setScoring(settings)
        goTo('preview')
      },
      (e: unknown) => {
        setOpeningPreview(false)
        handleGatewayError(e)
      },
    )
  }

  function changeScoring(settings: ScoringSettings) {
    if (!viewer || !rankingKey) return
    saveScoringSettings(localStorage, rankingKey, { format: viewer.scoreFormat, settings })
    setScoring(settings)
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

  const hasProgress = Boolean(log) || savedBroken
  const menuItems = viewer
    ? buildMenuItems(
        { mediaType, statuses, hasLog: Boolean(log), hasProgress, ranking, choosingBand: screen === 'bands', splitOffers: offers },
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
        },
      )
    : []

  const form = viewer
    ? {
        viewer,
        mediaType,
        statuses,
        pool,
        saved: ranking?.progress.roughSort ?? null,
        // Offered for a new Ranking only.
        scoresPlan: hasProgress ? null : scoresPlan,
        bandDuels: ranking ? duelsFromBands(ranking) : null,
        onMediaType: switchMediaType,
        onToggleStatus: (s: ListStatus) => {
          const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]
          savePoolSettings(localStorage, { userId: viewer.id, mediaType }, { statuses: next })
          setStatuses(next)
        },
        onLogout: () => setDialog('logout'),
        onStartRoughSort: savedBroken ? undefined : startOrContinue,
        onRestore: () => setDialog('restore'),
      }
    : null

  // Wait for the list's display data, unless AniList is unreachable: answers still work then, with plain cards.
  const inRanking =
    (screen === 'ranking' || screen === 'bands' || screen === 'board' || screen === 'preview' || screen === 'import') && viewer && ranking && (list || notice)
  const importView = imports.view
  const inImport = screen === 'import' && importView
  // Preview only for a finished Ranking whose old scores are loaded; otherwise the Ranking screen shows.
  const inPreview = screen === 'preview' && ranking?.prompt.kind === 'all-complete' && scoring && pool

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
          // The last check comes before any Duel (#34), so the Band choice comes after it, not straight away.
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
            note={previewFix?.id === prompt.a ? `${previewFix.verb}: ${nameOf(prompt.a)}` : undefined}
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
      {inRanking && inImport ? (
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
          overrides={imports.ticks}
          onTick={imports.tick}
          onImport={importView?.stage === 'running' ? undefined : (plan) => imports.plan(plan, scoring)}
          onRerank={(id) => fixFromPreview(id, 'Re-ranking', answer({ type: 'rerank-requested', id }))}
          onMove={setPreviewMoving}
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
