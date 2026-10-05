// Screens are chosen from app state, not by a router (ADR 0004).
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { AniListError, createAniListGateway } from '../anilist/gateway.ts'
import type { ListEntry, ListStatus, MediaType, Viewer } from '../anilist/types.ts'
import { authorizeUrl, logout, restoreSession } from '../auth/session.ts'
import { aniListClientId } from '../config.ts'
import { DEFAULT_STATUSES, OFFERED_STATUSES, buildPool } from '../pool/pool.ts'
import { LogoutDialog } from './LogoutDialog.tsx'
import { Shell, type Notice } from './Shell.tsx'
import { StartScreen } from './start/StartScreen.tsx'
import { useTheme } from './theme.ts'

function loginRedirect() {
  window.location.assign(authorizeUrl(aniListClientId({ dev: import.meta.env.DEV })))
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
  const [notice, setNotice] = useState<Notice | null>(null)
  const [retries, setRetries] = useState(0)
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  const gateway = useMemo(() => (token ? createAniListGateway({ fetch: window.fetch.bind(window), token }) : null), [token])

  function endSession(deleteProgress: boolean) {
    logout(localStorage, { userId: viewer?.id ?? null, deleteProgress })
    setToken(null)
    setViewer(null)
    setLists({})
    setStatuses(DEFAULT_STATUSES)
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

  useEffect(() => {
    if (!gateway || viewer) return
    let cancelled = false
    gateway.viewer().then(
      (v) => !cancelled && setViewer(v),
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

  const form = viewer
    ? {
        viewer,
        mediaType,
        statuses,
        pool,
        onMediaType: setMediaType,
        onToggleStatus: (s: ListStatus) =>
          setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])),
        onLogout: () => setConfirmingLogout(true),
      }
    : null

  return (
    <Shell notice={notice}>
      <StartScreen
        form={form}
        covers={pool?.titles ?? list ?? []}
        loggingIn={Boolean(token) && !viewer && !notice}
        onLogin={loginRedirect}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
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
