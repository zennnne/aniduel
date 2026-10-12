// Sync (issue #13, ADR 0005): brings the Pool in the Duel log up to date with the user's AniList list.
import type { ListEntry, ListStatus, TitleLanguage } from '../anilist/types.ts'
import type { DuelLog, LogEvent } from '../ranking/engine.ts'
import type { SavedKeepMyScale } from './anchors.ts'
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
 * A Keep My Scale log's Anchors (its snapshot, ADR 0009) and the titles in its Pool; null for any other log.
 * What `keepMyScalePool` needs to build that Ranking's Pool from a fetched list.
 */
export function keepMyScaleInLog(log: DuelLog): SavedKeepMyScale | null {
  const snapshot = log.events.find((event) => event.type === 'anchors-set')
  if (!snapshot) return null
  return { anchors: new Set(snapshot.anchors.map((a) => a.id)), pool: new Set(poolInLog(log)) }
}

/**
 * The sync events that make the log's Pool match the fetched list under the chosen statuses: removals first
 * (in log order), then additions in Rough Sort order. Empty when nothing changed, e.g. when a title only moved
 * between two chosen statuses. Used on resume and after the status filter changes. A Keep My Scale Pool is fixed once
 * its Ranking starts (ADR 0011): nothing joins, and only titles no longer on the list leave, whatever their status.
 */
export function syncEvents(
  log: DuelLog,
  list: readonly ListEntry[],
  statuses: readonly ListStatus[],
  language: TitleLanguage,
): LogEvent[] {
  const current = poolInLog(log)
  if (keepMyScaleInLog(log)) {
    const onList = new Set(list.map((e) => e.mediaId))
    const removed = current.filter((id) => !onList.has(id))
    return removed.length > 0 ? [{ type: 'titles-removed', ids: removed }] : []
  }
  const wanted = buildPool(list, statuses).titles
  const wantedIds = new Set(wanted.map((e) => e.mediaId))
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
