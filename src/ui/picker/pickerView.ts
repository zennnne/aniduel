// The Picker's view (#64, ADR 0011): the titles a Keep My Scale Ranking can be started on, which of them are picked,
// what the picks leave as Anchors, and what Confirm would start. Pure; App keeps the picks and adds the handlers.
//
// Built as a pipeline the later Picker tickets extend: `pickable` (every title but Planning ones) → rows in the
// default order → summary and Confirm over the picks, which never depend on what the rows show.
import type { ListEntry, ListStatus, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import { anchorsOf, estimateKeepMyScaleDuels, keepMyScaleEligibility, MIN_ANCHOR_SCORES, MIN_ANCHORS } from '../../pool/anchors.ts'
import { displayTitle, roughSortOrder } from '../../pool/pool.ts'
import type { AnchorScore } from '../../ranking/engine.ts'
import { formatLevel, levelOfRaw } from '../../ranking/scoring.ts'

export type PickerInput = {
  /** The Media Type's list, fetched for every offered status. */
  list: readonly ListEntry[]
  scoreFormat: ScoreFormat
  titleLanguage: TitleLanguage
  /** The ids ticked so far. Kept by App, in memory only (#61). */
  picked: ReadonlySet<number>
}

/** One title the Picker lists. */
export type PickerRow = {
  entry: ListEntry
  /** The name in the user's title language. */
  title: string
  /** The current score as the Score Format shows it; null without one. */
  score: string | null
  /** Release year; null when AniList has none. */
  year: number | null
  status: ListStatus
  picked: boolean
}

/** What the picks cost, updated on every tick. */
export type PickerSummary = {
  /** Titles picked (those still on the list). */
  picked: number
  /** Anchors left after the picks (ADR 0011), and on how many distinct scores. */
  anchors: number
  scores: number
  /** About how many Duels the picks take against those scores. */
  duels: number
}

/**
 * Whether Confirm may start a Keep My Scale Ranking, and on what: the picked titles in Rough Sort order and the
 * Anchor snapshot, which never holds a picked title. When it may not, the reason as the Picker shows it.
 */
export type PickerConfirm = { allowed: true; order: number[]; anchors: AnchorScore[] } | { allowed: false; reason: string }

export type PickerView = {
  /** The rows shown, in order. */
  rows: PickerRow[]
  summary: PickerSummary
  confirm: PickerConfirm
}

/**
 * How the Picker was opened, which decides its starting picks. From Start nothing is ticked (#64); Catch-up's exit
 * offer (#65) and the remembered unsettled titles (#66) add their own ways in here.
 */
export type PickerEntry = { from: 'start' }

/** The picks the Picker opens with, for the way it was opened. */
export function startingPicks(_list: readonly ListEntry[], entry: PickerEntry): Set<number> {
  switch (entry.from) {
    case 'start':
      return new Set()
  }
}

/** The picks after one click on a title: ticked if it wasn't, unticked if it was. */
export function togglePick(picked: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(picked)
  if (!next.delete(id)) next.add(id)
  return next
}

/** The titles the Picker can offer: every title on the list except Planning ones (ADR 0011). */
function pickable(list: readonly ListEntry[]): ListEntry[] {
  return list.filter((e) => e.status !== 'PLANNING')
}

/** The default order: titles without a score first, then Rough Sort's order (most recently completed first, then by name). */
function defaultOrder(entries: readonly ListEntry[], language: TitleLanguage): ListEntry[] {
  const byId = new Map(entries.map((e) => [e.mediaId, e]))
  const ordered = roughSortOrder(entries, language).map((id) => byId.get(id)!)
  return [...ordered.filter((e) => e.oldScore100 === 0), ...ordered.filter((e) => e.oldScore100 > 0)]
}

export function pickerView(input: PickerInput): PickerView {
  const { list, scoreFormat, titleLanguage, picked } = input
  const rows = defaultOrder(pickable(list), titleLanguage).map((entry): PickerRow => {
    const level = levelOfRaw(scoreFormat, entry.oldScore100)
    return {
      entry,
      title: displayTitle(entry.title, titleLanguage),
      score: level > 0 ? formatLevel(scoreFormat, level) : null,
      year: entry.year,
      status: entry.status,
      picked: picked.has(entry.mediaId),
    }
  })
  const pickedEntries = pickable(list).filter((e) => picked.has(e.mediaId))
  const pickedIds = new Set(pickedEntries.map((e) => e.mediaId))
  // Every scored title is an Anchor, Planning ones included (ADR 0009), except the picks.
  const anchors = anchorsOf(list, scoreFormat, pickedIds)
  const left = keepMyScaleEligibility(anchors)
  const summary: PickerSummary = {
    picked: pickedEntries.length,
    anchors: left.anchors,
    scores: left.scores,
    duels: estimateKeepMyScaleDuels(pickedEntries.length, left.scores),
  }
  return { rows, summary, confirm: confirmOf(pickedEntries, anchors, summary, titleLanguage) }
}

function confirmOf(picked: readonly ListEntry[], anchors: AnchorScore[], summary: PickerSummary, language: TitleLanguage): PickerConfirm {
  if (picked.length === 0) return { allowed: false, reason: 'Pick at least one title.' }
  if (summary.anchors < MIN_ANCHORS || summary.scores < MIN_ANCHOR_SCORES) {
    return {
      allowed: false,
      reason:
        `Your picks leave ${summary.anchors} scored titles on ${summary.scores} different scores; ` +
        `at least ${MIN_ANCHORS} on ${MIN_ANCHOR_SCORES} are needed. Untick some scored titles.`,
    }
  }
  return { allowed: true, order: roughSortOrder(picked, language), anchors }
}
