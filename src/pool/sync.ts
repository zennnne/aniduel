// Sync (issue #13, ADR 0005): brings the Pool in the Duel log up to date with the user's AniList list.
import type { ListEntry, ListStatus, TitleLanguage } from '../anilist/types.ts'
import type { DuelLog, LogEvent } from '../ranking/engine.ts'
import { buildPool, roughSortOrder } from './pool.ts'

/** The titles in the log's Pool (Forgotten ones included), in the order they joined. Only sync events count. */
export function poolInLog(log: DuelLog): number[] {
  const members = new Set<number>()
  for (const event of log.events) {
    if (event.type === 'titles-added') event.ids.forEach((id) => members.add(id))
    else if (event.type === 'titles-removed') event.ids.forEach((id) => members.delete(id))
  }
  return [...members]
}

/**
 * The sync events that make the log's Pool match the fetched list under the chosen statuses: removals first
 * (in log order), then additions in Rough Sort order. Empty when nothing changed, e.g. when a title only moved
 * between two chosen statuses. Used on resume and after the status filter changes.
 */
export function syncEvents(
  log: DuelLog,
  list: readonly ListEntry[],
  statuses: readonly ListStatus[],
  language: TitleLanguage,
): LogEvent[] {
  const wanted = buildPool(list, statuses).titles
  const wantedIds = new Set(wanted.map((e) => e.mediaId))
  const current = poolInLog(log)
  const inLog = new Set(current)
  const removed = current.filter((id) => !wantedIds.has(id))
  const added = roughSortOrder(
    wanted.filter((e) => !inLog.has(e.mediaId)),
    language,
  )
  const events: LogEvent[] = []
  if (removed.length > 0) events.push({ type: 'titles-removed', ids: removed })
  if (added.length > 0) events.push({ type: 'titles-added', ids: added })
  return events
}
