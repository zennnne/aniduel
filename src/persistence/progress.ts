// Persistence: localStorage keys for a user's saved progress, keyed by AniList user id and Media Type.
// Every key belonging to one user starts with `aniduel/progress/<userId>/`, so logout can delete them all.
import type { ListStatus, MediaType } from '../anilist/types.ts'
import { isStatusWrite, parseImportState, parseWriteQueue, type ImportState, type StatusWrite } from '../import/runner.ts'
import { OFFERED_STATUSES } from '../pool/pool.ts'
import type { DuelLog } from '../ranking/engine.ts'
import type { TickOverrides } from '../ranking/preview.ts'
import { parseSavedScoring, type SavedScoring } from '../ranking/scoring.ts'

export type ProgressKey = { userId: number; mediaType: MediaType; part: string }

const PREFIX = 'aniduel/progress/'

function userPrefix(userId: number): string {
  return `${PREFIX}${userId}/`
}

export function progressStorageKey({ userId, mediaType, part }: ProgressKey): string {
  return `${userPrefix(userId)}${mediaType}/${part}`
}

export function saveProgressPart(storage: Storage, key: ProgressKey, value: string): void {
  storage.setItem(progressStorageKey(key), value)
}

export function loadProgressPart(storage: Storage, key: ProgressKey): string | null {
  return storage.getItem(progressStorageKey(key))
}

export type RankingKey = { userId: number; mediaType: MediaType }

/** Saved progress exists but can't be used. The app must not overwrite it by starting over. */
export class SavedProgressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SavedProgressError'
  }
}

const LOG_PART = 'duel-log'

/** Saves the whole Duel log under the user id and Media Type from its header. Call after every answer. */
export function saveDuelLog(storage: Storage, log: DuelLog): void {
  const { userId, mediaType } = log.header
  saveProgressPart(storage, { userId, mediaType, part: LOG_PART }, JSON.stringify(log))
}

/** The saved Duel log for this user and Media Type, or null if there is none. Throws SavedProgressError if it is unusable. */
export function loadDuelLog(storage: Storage, key: RankingKey): DuelLog | null {
  const raw = loadProgressPart(storage, { ...key, part: LOG_PART })
  if (raw === null) return null
  let log: DuelLog
  try {
    log = JSON.parse(raw) as DuelLog
  } catch {
    throw new SavedProgressError('The saved Ranking in this browser is unreadable.')
  }
  if (log?.header?.userId !== key.userId || log.header.mediaType !== key.mediaType || !Array.isArray(log.events)) {
    throw new SavedProgressError('The saved Ranking in this browser does not belong to this account.')
  }
  return log
}

/**
 * Start over: throws away the Ranking for this user and Media Type. The log itself is never edited (ADR 0005);
 * it is deleted as a whole. The Pool settings stay, so a new Ranking starts from the same statuses.
 */
export function deleteDuelLog(storage: Storage, key: RankingKey): void {
  storage.removeItem(progressStorageKey({ ...key, part: LOG_PART }))
}

export type PoolSettings = { statuses: ListStatus[] }

const POOL_PART = 'pool-settings'

export function savePoolSettings(storage: Storage, key: RankingKey, settings: PoolSettings): void {
  saveProgressPart(storage, { ...key, part: POOL_PART }, JSON.stringify(settings))
}

/** The saved Pool settings, keeping only statuses that can be offered; null if none or unreadable. */
export function loadPoolSettings(storage: Storage, key: RankingKey): PoolSettings | null {
  const raw = loadProgressPart(storage, { ...key, part: POOL_PART })
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as { statuses?: unknown }
    if (!Array.isArray(parsed.statuses)) return null
    const offered: readonly string[] = OFFERED_STATUSES
    return { statuses: parsed.statuses.filter((s): s is ListStatus => offered.includes(s)) }
  } catch {
    return null
  }
}

const SCORING_PART = 'scoring-settings'

/** Saves best / worst / Distribution with the Score Format they were chosen in (ADR 0003). */
export function saveScoringSettings(storage: Storage, key: RankingKey, saved: SavedScoring): void {
  saveProgressPart(storage, { ...key, part: SCORING_PART }, JSON.stringify(saved))
}

/** The saved scoring settings, or null if none or unreadable. */
export function loadScoringSettings(storage: Storage, key: RankingKey): SavedScoring | null {
  const raw = loadProgressPart(storage, { ...key, part: SCORING_PART })
  if (raw === null) return null
  try {
    return parseSavedScoring(JSON.parse(raw))
  } catch {
    return null
  }
}

const IMPORT_PART = 'import'

/** Saves the Import plan, its hash and the status of each write. Called after every write. */
export function saveImportState(storage: Storage, key: RankingKey, state: ImportState): void {
  saveProgressPart(storage, { ...key, part: IMPORT_PART }, JSON.stringify(state))
}

/** The saved Import, or null if none or unreadable. */
export function loadImportState(storage: Storage, key: RankingKey): ImportState | null {
  const raw = loadProgressPart(storage, { ...key, part: IMPORT_PART })
  if (raw === null) return null
  try {
    return parseImportState(JSON.parse(raw))
  } catch {
    return null
  }
}

export function deleteImportState(storage: Storage, key: RankingKey): void {
  storage.removeItem(progressStorageKey({ ...key, part: IMPORT_PART }))
}

const CATCH_UP_QUEUE_PART = 'catchup-queue'

/** A Catch-up status write, with the title's name for the failure bar. */
export type NamedStatusWrite = StatusWrite & { name: string }

/** Catch-up is anime only, so its write queue is saved under the user's anime progress. */
const catchUpKey = (userId: number) => ({ userId, mediaType: 'ANIME' as const, part: CATCH_UP_QUEUE_PART })

/** Saves Catch-up's write queue (every saved page's status writes). Called after every write. */
export function saveCatchUpQueue(storage: Storage, userId: number, state: ImportState<NamedStatusWrite>): void {
  saveProgressPart(storage, catchUpKey(userId), JSON.stringify(state))
}

/** The saved Catch-up write queue, or null if none or unreadable. */
export function loadCatchUpQueue(storage: Storage, userId: number): ImportState<NamedStatusWrite> | null {
  const raw = loadProgressPart(storage, catchUpKey(userId))
  if (raw === null) return null
  try {
    const state = parseWriteQueue(JSON.parse(raw))
    const named = state?.writes.every((w) => isStatusWrite(w) && typeof (w as Partial<NamedStatusWrite>).name === 'string')
    return named ? (state as ImportState<NamedStatusWrite>) : null
  } catch {
    return null
  }
}

export function deleteCatchUpQueue(storage: Storage, userId: number): void {
  storage.removeItem(progressStorageKey(catchUpKey(userId)))
}

const TICKS_PART = 'import-ticks'

/** Saves the Import ticks the user changed on Preview (#1 US52), so an unticked title stays unticked after a reload. */
export function saveTickOverrides(storage: Storage, key: RankingKey, ticks: TickOverrides): void {
  saveProgressPart(storage, { ...key, part: TICKS_PART }, JSON.stringify([...ticks]))
}

/** The saved tick changes; entries it doesn't understand are dropped, and none or unreadable gives an empty map. */
export function loadTickOverrides(storage: Storage, key: RankingKey): Map<number, boolean> {
  const raw = loadProgressPart(storage, { ...key, part: TICKS_PART })
  if (raw === null) return new Map()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const valid = parsed.filter(
      (e: unknown): e is [number, boolean] =>
        Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && typeof e[1] === 'boolean',
    )
    return new Map(valid)
  } catch {
    return new Map()
  }
}

export function deleteTickOverrides(storage: Storage, key: RankingKey): void {
  storage.removeItem(progressStorageKey({ ...key, part: TICKS_PART }))
}

function lastMediaTypeKey(userId: number): string {
  return `${userPrefix(userId)}last-media-type`
}

/** Remembers the Media Type the user last worked on, so a returning user lands back on it. */
export function saveLastMediaType(storage: Storage, userId: number, mediaType: MediaType): void {
  storage.setItem(lastMediaTypeKey(userId), mediaType)
}

export function loadLastMediaType(storage: Storage, userId: number): MediaType | null {
  const value = storage.getItem(lastMediaTypeKey(userId))
  return value === 'ANIME' || value === 'MANGA' ? value : null
}

/** Deletes everything saved for one user in this browser (every Media Type). */
export function deleteSavedProgress(storage: Storage, userId: number): void {
  const prefix = userPrefix(userId)
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}
