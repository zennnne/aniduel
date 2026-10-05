// Backup and Restore: one Ranking's Duel log and settings as a versioned JSON file (issue #12).
import type { MediaType } from '../anilist/types.ts'
import { ENGINE_VERSION, LOG_FORMAT_VERSION, replay, type DuelLog } from '../ranking/engine.ts'
import {
  loadDuelLog,
  loadPoolSettings,
  saveDuelLog,
  savePoolSettings,
  type PoolSettings,
  type RankingKey,
} from './progress.ts'

export const BACKUP_VERSION = 1

/** The file's contents. `log.header` carries the user id and Media Type too; these copies make the file readable at a glance. */
export type Backup = {
  app: 'aniduel'
  version: number
  savedAt: string
  userId: number
  mediaType: MediaType
  log: DuelLog
  settings: { pool: PoolSettings | null }
}

/** The Backup file for one Ranking, or null if there is nothing saved to back up. */
export function createBackup(
  storage: Storage,
  key: RankingKey & { userName: string },
  now: Date,
): { fileName: string; json: string } | null {
  const { userId, mediaType } = key
  const log = loadDuelLog(storage, { userId, mediaType })
  if (!log) return null
  const backup: Backup = {
    app: 'aniduel',
    version: BACKUP_VERSION,
    savedAt: now.toISOString(),
    userId,
    mediaType,
    log,
    settings: { pool: loadPoolSettings(storage, { userId, mediaType }) },
  }
  return { fileName: backupFileName(key.userName, mediaType, now), json: JSON.stringify(backup, null, 1) }
}

function backupFileName(userName: string, mediaType: MediaType, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const safeName = userName.replace(/[^A-Za-z0-9_-]/g, '_')
  return `aniduel-${safeName}-${mediaType.toLowerCase()}-${day}.json`
}

/** A Backup file that can't be restored here. The message is shown to the user as is. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

const MEDIA_LABEL: Record<MediaType, string> = { ANIME: 'Anime', MANGA: 'Manga' }

/**
 * Parses a Backup file and checks it can replace the progress for this user and Media Type:
 * the version, the user id, the Media Type, and that its Duel log replays. Throws BackupError otherwise.
 */
export function readBackup(json: string, key: RankingKey): Backup {
  let parsed: Partial<Backup> | null
  try {
    parsed = JSON.parse(json) as Partial<Backup> | null
  } catch {
    parsed = null
  }
  const log = parsed?.log
  if (parsed?.app !== 'aniduel' || typeof parsed.version !== 'number' || !log?.header || !Array.isArray(log.events)) {
    throw new BackupError('This file is not an AniDuel! Backup.')
  }
  if (parsed.version > BACKUP_VERSION || log.header.format > LOG_FORMAT_VERSION || log.header.engine > ENGINE_VERSION) {
    throw new BackupError('This Backup was made by a newer version of AniDuel!.')
  }
  if (parsed.userId !== key.userId || log.header.userId !== key.userId) {
    throw new BackupError('This Backup belongs to a different AniList account.')
  }
  if (parsed.mediaType !== key.mediaType || log.header.mediaType !== key.mediaType) {
    const other = log.header.mediaType === key.mediaType ? parsed.mediaType : log.header.mediaType
    const label = other === 'ANIME' || other === 'MANGA' ? MEDIA_LABEL[other] : 'another Media Type'
    throw new BackupError(`This Backup is for ${label} — switch to ${label} first.`)
  }
  try {
    replay(log)
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'unknown error'
    throw new BackupError(`This Backup is damaged: its Duel log can't be replayed (${reason}).`)
  }
  const pool = parsed.settings?.pool
  return {
    app: 'aniduel',
    version: parsed.version,
    savedAt: String(parsed.savedAt ?? ''),
    userId: key.userId,
    mediaType: key.mediaType,
    log,
    settings: { pool: pool && Array.isArray(pool.statuses) ? { statuses: pool.statuses } : null },
  }
}

/** Replaces the saved progress for the Backup's user and Media Type with the Backup's. */
export function restoreBackup(storage: Storage, backup: Backup): void {
  saveDuelLog(storage, backup.log)
  if (backup.settings.pool) savePoolSettings(storage, backup.log.header, backup.settings.pool)
}
