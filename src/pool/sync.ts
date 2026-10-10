// Sync (issue #13, ADR 0005): brings the Pool in the Duel log up to date with the user's AniList list.
import type { ListEntry, ListStatus, TitleLanguage } from '../anilist/types.ts'
import type { DuelLog, LogEvent } from '../ranking/engine.ts'
import { newTitlesList } from './anchors.ts'
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
 * A Score New Titles log's Anchors (its snapshot, ADR 0009) and the titles in its Pool; null for any other log.
 * What `newTitlesList` needs to build that Ranking's Pool from a fetched list.
 */
export function newTitlesInLog(log: DuelLog): { anchors: ReadonlySet<number>; pool: ReadonlySet<number> } | null {
  const snapshot = log.events.find((event) => event.type === 'anchors-set')
  if (!snapshot) return null
  return { anchors: new Set(snapshot.anchors.map((a) => a.id)), pool: new Set(poolInLog(log)) }
}

/**
 * The sync events that make the log's Pool match the fetched list under the chosen statuses: removals first
 * (in log order), then additions in Rough Sort order. Empty when nothing changed, e.g. when a title only moved
 * between two chosen statuses. Used on resume and after the status filter changes. On a Score New Titles log only
 * titles without a score join, never an Anchor (ADR 0009).
 */
export function syncEvents(
  log: DuelLog,
  list: readonly ListEntry[],
  statuses: readonly ListStatus[],
  language: TitleLanguage,
): LogEvent[] {
  const saved = newTitlesInLog(log)
  const wanted = buildPool(saved ? newTitlesList(list, saved) : list, statuses).titles
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
