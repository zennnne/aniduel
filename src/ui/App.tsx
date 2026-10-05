// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { AniListError, createAniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, MediaType, TitleLanguage, Viewer } from '../anilist/types.ts'
import { authorizeUrl, logout, restoreSession } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import { createBackup, restoreBackup, type Backup } from '../persistence/backup.ts'
import {
  deleteDuelLog,
  loadDuelLog,
  loadLastMediaType,
  loadPoolSettings,
  saveDuelLog,
  saveLastMediaType,
  savePoolSettings,
} from '../persistence/progress.ts'
import { DEFAULT_STATUSES, OFFERED_STATUSES, buildPool, roughSortOrder } from '../pool/pool.ts'
import { appendEvent, replay, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'
import { splitOffers } from '../ranking/split.ts'
import { BAND_UI } from './bands.ts'
import { SplitScreen } from './split/SplitScreen.tsx'
import { CompleteScreen } from './duel/CompleteScreen.tsx'
import { DuelScreen } from './duel/DuelScreen.tsx'
import { LogoutDialog } from './LogoutDialog.tsx'
import { AccountMenu, CommandPalette } from './menu/AppMenu.tsx'
import type { MenuItem } from './menu/menuItems.ts'
import { RestoreDialog, StartOverDialog } from './menu/BackupDialogs.tsx'
import { RankingSidebar } from './RankingSidebar.tsx'
import { RoughSortScreen } from './roughsort/RoughSortScreen.tsx'
import { Shell, type Notice } from './Shell.tsx'
import { StartScreen } from './start/StartScreen.tsx'
import { useTheme } from './theme.ts'

type Screen = 'start' | 'ranking'
type DialogName = 'logout' | 'restore' | 'start-over'

const MEDIA_LABEL: Record<MediaType, string> = { ANIME: 'Anime', MANGA: 'Manga' }
const TOAST_MS = 4000

/** Duel answers in the log (cancelled ones included). */
function countDuels(log: DuelLog): number {
  return log.events.filter((e) => e.type === 'duel-answered').length
}

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
  const [mediaType, setMediaType] = useState<MediaType>('ANIME')
  const [statuses, setStatuses] = useState<readonly ListStatus[]>(DEFAULT_STATUSES)
  const [log, setLog] = useState<DuelLog | null>(null)
  // Saved progress that exists but can't be used. Starting over would overwrite it, so Start is blocked.
  const [savedBroken, setSavedBroken] = useState(false)
  const [screen, setScreen] = useState<Screen>('start')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [retries, setRetries] = useState(0)
  const [dialog, setDialog] = useState<DialogName | null>(null)
  const [splitView, setSplitView] = useState<{ band: BandIndex } | null>(null)
  // Bands whose split offer was turned down ("Keep it as it is") in this session.
  const [skippedSplits, setSkippedSplits] = useState<readonly BandIndex[]>([])
  // A new object per toast, so showing the same message twice restarts its timer.
  const [toast, setToast] = useState<{ message: ReactNode } | null>(null)
  // The latest log, updated synchronously so two quick key presses never append to a stale log.
  const logRef = useRef<DuelLog | null>(null)

  const gateway = useMemo(() => (token ? createAniListGateway({ fetch: window.fetch.bind(window), token }) : null), [token])

  const showToast = (message: ReactNode) => setToast({ message })
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  function setCurrentLog(next: DuelLog | null) {
    logRef.current = next
    setLog(next)
  }

  /** Every screen change pushes a history entry, so the browser's back button returns to the previous screen. */
  function goTo(next: Screen) {
    window.history.pushState({ screen: next }, '')
    setScreen(next)
  }

  useEffect(() => {
    window.history.replaceState({ screen: 'start' }, '')
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { screen?: Screen } | null
      setScreen(state?.screen === 'ranking' ? 'ranking' : 'start')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /**
   * Loads what is saved for this user and Media Type; with `resume`, a saved Ranking opens straight away.
   * Returns whether a usable Ranking was found.
   */
  function openRanking(userId: number, type: MediaType, resume: boolean): boolean {
    setMediaType(type)
    setSplitView(null)
    setSkippedSplits([])
    setStatuses(loadPoolSettings(localStorage, { userId, mediaType: type })?.statuses ?? DEFAULT_STATUSES)
    try {
      const saved = loadDuelLog(localStorage, { userId, mediaType: type })
      if (saved) replay(saved) // refuse a log the engine can't replay before showing anything from it
      setCurrentLog(saved)
      setSavedBroken(false)
      if (saved && resume) goTo('ranking')
      return saved !== null
    } catch (e) {
      setCurrentLog(null)
      setSavedBroken(true)
      setNotice({
        tone: 'error',
        message: `Your saved ${MEDIA_LABEL[type]} progress in this browser can't be used (${e instanceof Error ? e.message : 'unknown error'}). It was left untouched.`,
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
    setCurrentLog(null)
    setSavedBroken(false)
    setSplitView(null)
    setScreen('start')
  }

  const onGatewayError = useEffectEvent((error: unknown) => {
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
  })

  const onViewer = useEffectEvent((v: Viewer) => {
    setViewer(v)
    openRanking(v.id, loadLastMediaType(localStorage, v.id) ?? 'ANIME', true)
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

  useEffect(() => {
    if (!gateway || !viewer || lists[mediaType]) return
    let cancelled = false
    // Fetch every offered status once, so each chip can show its count and toggling needs no refetch.
    gateway.mediaList({ userId: viewer.id, type: mediaType, statuses: OFFERED_STATUSES }).then(
      (list) => !cancelled && setLists((prev) => ({ ...prev, [mediaType]: list })),
      (e: unknown) => !cancelled && onGatewayError(e),
    )
    return () => {
      cancelled = true
    }
  }, [gateway, viewer, mediaType, lists, retries])

  const list = lists[mediaType]
  const pool = useMemo(() => (list ? buildPool(list, statuses) : null), [list, statuses])
  const entries = useMemo(() => new Map((list ?? []).map((e) => [e.mediaId, e])), [list])
  const ranking = useMemo(() => (log ? replay(log) : null), [log])

  // Band split (ADR 0006). Offered on its own after Rough Sort, before the first Duel answer, for each Band that
  // qualifies and wasn't skipped in this session; later only from the menu. `splitView` pins the Split screen open
  // (from the menu, or through its "done" step, when the Band no longer qualifies).
  const offers = ranking ? splitOffers(ranking) : []
  const autoOffer =
    ranking?.prompt.kind === 'duel' && log && countDuels(log) === 0 ? offers.find((band) => !skippedSplits.includes(band)) : undefined
  const splitBand = splitView?.band ?? autoOffer ?? null

  /** Appends one answer, checks it replays, and saves the log before showing the result. */
  function answer(event: LogEvent) {
    const current = logRef.current
    if (!current) return
    const next = appendEvent(current, event)
    try {
      replay(next)
    } catch {
      return // an answer for a prompt that is no longer showing (e.g. a double key press)
    }
    saveDuelLog(localStorage, next)
    setCurrentLog(next)
  }

  function startOrContinue() {
    if (!viewer) return
    if (!logRef.current) {
      if (!pool) return
      const fresh = startLog({
        seed: newSeed(),
        userId: viewer.id,
        mediaType,
        ids: roughSortOrder(pool.titles, viewer.titleLanguage),
      })
      saveDuelLog(localStorage, fresh)
      setCurrentLog(fresh)
    }
    goTo('ranking')
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
    if (!viewer) return
    restoreBackup(localStorage, backup)
    setDialog(null)
    setNotice(null)
    if (openRanking(viewer.id, mediaType, false)) goTo('ranking')
    showToast(`Restored ${backup.log.events.length} events from Backup`)
  }

  /** Runs only after the user confirmed in the Start over dialog. */
  function startOver() {
    if (!viewer) return
    deleteDuelLog(localStorage, { userId: viewer.id, mediaType })
    setDialog(null)
    setNotice(null)
    openRanking(viewer.id, mediaType, false)
    goTo('start')
    showToast(`Your ${MEDIA_LABEL[mediaType]} Ranking was thrown away.`)
  }

  function switchMediaType(type: MediaType) {
    if (!viewer || type === mediaType) return
    saveLastMediaType(localStorage, viewer.id, type)
    const inRankingNow = screen === 'ranking'
    if (!openRanking(viewer.id, type, inRankingNow) && inRankingNow) goTo('start')
  }

  const otherMediaType: MediaType = mediaType === 'ANIME' ? 'MANGA' : 'ANIME'
  const hasProgress = Boolean(log) || savedBroken
  const menuItems: MenuItem[] = []
  if (viewer) {
    menuItems.push(
      // run() is only ever called from a click or key handler, never during render.
      // oxlint-disable-next-line react/refs
      {
        id: 'switch-media-type',
        group: 'This Ranking',
        icon: '⇆',
        title: `Switch to ${MEDIA_LABEL[otherMediaType]}`,
        description: 'Each Media Type keeps its own Ranking',
        run: () => {
          switchMediaType(otherMediaType)
          showToast(
            <>
              Switched to <b>{MEDIA_LABEL[otherMediaType]}</b> — your {MEDIA_LABEL[mediaType]} Ranking is kept
            </>,
          )
        },
      },
      {
        id: 'statuses',
        group: 'This Ranking',
        icon: '☰',
        title: 'Change list statuses',
        description: 'Choose which list statuses are in the Pool',
        run: () => goTo('start'),
      },
    )
    if (log) {
      menuItems.push({
        id: 'backup',
        group: 'This Ranking',
        icon: '↓',
        title: 'Save Backup file',
        description: 'Download your Duel log and settings',
        run: saveBackup,
      })
    }
    // Split offers after Rough Sort, under the same rule as the automatic offer (ADR 0006).
    if (ranking && ranking.prompt.kind !== 'rough-sort') {
      for (const band of offers) {
        menuItems.push({
          id: `split-band-${band}`,
          group: 'This Ranking',
          icon: '⫼',
          title: `Split ${BAND_UI[band].label} into 3 groups`,
          description: `${ranking.bands[band].unplaced.length} titles without a place: Best / Middle / Lowest cuts the Duels`,
          run: () => {
            setSplitView({ band })
            goTo('ranking')
          },
        })
      }
    }
    menuItems.push({
      id: 'restore',
      group: 'This Ranking',
      icon: '↑',
      title: 'Restore from Backup',
      description: 'Load a Backup file from another browser',
      run: () => setDialog('restore'),
    })
    if (hasProgress) {
      menuItems.push({
        id: 'start-over',
        group: 'This Ranking',
        icon: '↺',
        title: 'Start this Ranking over',
        description: `Throws away all Duels for ${MEDIA_LABEL[mediaType]}`,
        danger: true,
        run: () => setDialog('start-over'),
      })
    }
    menuItems.push(
      {
        id: 'theme',
        group: 'App',
        icon: '◐',
        title: 'Light / dark theme',
        description: 'Follows your system unless you pick one',
        run: toggleTheme,
      },
      {
        id: 'logout',
        group: 'Account',
        icon: '⎋',
        title: 'Log out',
        description: 'Removes your AniList token from this browser',
        run: () => setDialog('logout'),
      },
    )
  }

  const form = viewer
    ? {
        viewer,
        mediaType,
        statuses,
        pool,
        saved: ranking?.progress.roughSort ?? null,
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
  const inRanking = screen === 'ranking' && viewer && ranking && (list || notice)

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
          onClose={() => setSplitView(null)}
        />
      )
    }
    switch (prompt.kind) {
      case 'rough-sort':
        return (
          <RoughSortScreen
            {...shared}
            key={prompt.id}
            id={prompt.id}
            onBand={(band, sub) =>
              answer(sub === undefined ? { type: 'band-assigned', id: prompt.id, band } : { type: 'band-assigned', id: prompt.id, band, sub })
            }
            onForget={() => answer({ type: 'forgotten', id: prompt.id })}
          />
        )
      case 'duel':
        return (
          <DuelScreen
            {...shared}
            prompt={prompt}
            onPick={(winner) => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: winner === prompt.a ? 'a' : 'b' })}
            onTie={() => answer({ type: 'duel-answered', a: prompt.a, b: prompt.b, result: 'tie' })}
            onForget={(id) => answer({ type: 'forgotten', id })}
          />
        )
      case 'all-complete':
        return <CompleteScreen {...shared} />
    }
  }

  return (
    <Shell
      notice={notice}
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
                detail={`${MEDIA_LABEL[mediaType]} · ${ranking.progress.roughSort.total} titles`}
                items={menuItems}
              />
            }
          />
        ) : undefined
      }
    >
      {inRanking ? (
        rankingScreen(ranking, viewer.titleLanguage)
      ) : (
        <StartScreen
          form={form}
          covers={pool?.titles ?? list ?? []}
          loggingIn={Boolean(token) && !viewer && !notice}
          onLogin={loginRedirect}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}
      {viewer && !dialog && <CommandPalette items={menuItems} />}
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
          counts={ranking && log ? { roughSort: ranking.progress.roughSort.done, duels: countDuels(log) } : null}
          onConfirm={startOver}
          onSaveBackup={log ? saveBackup : undefined}
          onCancel={() => setDialog(null)}
        />
      )}
    </Shell>
  )
}
