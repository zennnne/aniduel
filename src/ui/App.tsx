// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { AniListError, createAniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, MediaType, TitleLanguage, Viewer } from '../anilist/types.ts'
import { authorizeUrl, logout, restoreSession } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import {
  loadDuelLog,
  loadLastMediaType,
  loadPoolSettings,
  saveDuelLog,
  saveLastMediaType,
  savePoolSettings,
} from '../persistence/progress.ts'
import { DEFAULT_STATUSES, OFFERED_STATUSES, buildPool, roughSortOrder } from '../pool/pool.ts'
import { replay, startLog, type DuelLog, type LogEvent, type RankingState } from '../ranking/engine.ts'
import { CompleteScreen } from './duel/CompleteScreen.tsx'
import { DuelScreen } from './duel/DuelScreen.tsx'
import { LogoutDialog } from './LogoutDialog.tsx'
import { RankingSidebar } from './RankingSidebar.tsx'
import { RoughSortScreen } from './roughsort/RoughSortScreen.tsx'
import { Shell, type Notice } from './Shell.tsx'
import { StartScreen } from './start/StartScreen.tsx'
import { useTheme } from './theme.ts'

type Screen = 'start' | 'ranking'

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
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  // The latest log, updated synchronously so two quick key presses never append to a stale log.
  const logRef = useRef<DuelLog | null>(null)

  const gateway = useMemo(() => (token ? createAniListGateway({ fetch: window.fetch.bind(window), token }) : null), [token])

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

  /** Loads what is saved for this user and Media Type; with `resume`, a saved Ranking opens straight away. */
  function openRanking(userId: number, type: MediaType, resume: boolean) {
    setMediaType(type)
    setStatuses(loadPoolSettings(localStorage, { userId, mediaType: type })?.statuses ?? DEFAULT_STATUSES)
    try {
      const saved = loadDuelLog(localStorage, { userId, mediaType: type })
      if (saved) replay(saved) // refuse a log the engine can't replay before showing anything from it
      setCurrentLog(saved)
      setSavedBroken(false)
      if (saved && resume) goTo('ranking')
    } catch (e) {
      setCurrentLog(null)
      setSavedBroken(true)
      setNotice({
        tone: 'error',
        message: `Your saved ${type === 'ANIME' ? 'Anime' : 'Manga'} progress in this browser can't be used (${e instanceof Error ? e.message : 'unknown error'}). It was left untouched.`,
      })
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

  /** Appends one answer, checks it replays, and saves the log before showing the result. */
  function answer(event: LogEvent) {
    const current = logRef.current
    if (!current) return
    const next: DuelLog = { ...current, events: [...current.events, event] }
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

  const form = viewer
    ? {
        viewer,
        mediaType,
        statuses,
        pool,
        saved: ranking?.progress.roughSort ?? null,
        onMediaType: (type: MediaType) => {
          if (type === mediaType) return
          saveLastMediaType(localStorage, viewer.id, type)
          openRanking(viewer.id, type, false)
        },
        onToggleStatus: (s: ListStatus) => {
          const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]
          savePoolSettings(localStorage, { userId: viewer.id, mediaType }, { statuses: next })
          setStatuses(next)
        },
        onLogout: () => setConfirmingLogout(true),
        onStartRoughSort: savedBroken ? undefined : startOrContinue,
      }
    : null

  // Wait for the list's display data, unless AniList is unreachable: answers still work then, with plain cards.
  const inRanking = screen === 'ranking' && viewer && ranking && (list || notice)

  /** The screen for the engine's next prompt: Rough Sort, a Duel, or the finished Ranking. */
  function rankingScreen(state: RankingState, titleLanguage: TitleLanguage) {
    const prompt = state.prompt
    const shared = { state, entries, titleLanguage, mediaType, onUndo: () => answer({ type: 'undo' }) }
    switch (prompt.kind) {
      case 'rough-sort':
        return (
          <RoughSortScreen
            {...shared}
            id={prompt.id}
            onBand={(band) => answer({ type: 'band-assigned', id: prompt.id, band })}
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
      sidebar={
        inRanking ? (
          <RankingSidebar viewer={viewer} mediaType={mediaType} state={ranking} entries={entries} titleLanguage={viewer.titleLanguage} />
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
      {confirmingLogout && (
        <LogoutDialog
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={(deleteProgress) => {
            setConfirmingLogout(false)
            endSession(deleteProgress)
          }}
        />
      )}
    </Shell>
  )
}
