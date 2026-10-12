// The Picker's view (#64, ADR 0011): the titles a Keep My Scale Ranking can be started on, which of them are picked,
// what the picks leave as Anchors, and what Confirm would start. Pure; App keeps the picks and adds the handlers.
//
// A pipeline: `pickable` (every title but Planning ones) → the rows the filters and the search let through, in the
// chosen sort (#65) → summary and Confirm over the picks, which never depend on what the rows show.
import type { ListEntry, ListStatus, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import {
  anchorsOf,
  estimateKeepMyScaleDuels,
  hasScore,
  keepMyScaleEligibility,
  MIN_ANCHOR_SCORES,
  MIN_ANCHORS,
  unscoredTitles,
  type KeepMyScaleEligibility,
} from '../../pool/anchors.ts'
import { DEFAULT_STATUSES, displayTitle, OFFERED_STATUSES, roughSortOrder } from '../../pool/pool.ts'
import type { AnchorScore } from '../../ranking/engine.ts'
import { formatLevel, levelOfRaw } from '../../ranking/scoring.ts'
import { count } from '../meta.ts'

export type PickerInput = {
  /** The Media Type's list, as read in `LIST_STATUSES`: its Planning titles are Anchors, never rows. */
  list: readonly ListEntry[]
  scoreFormat: ScoreFormat
  titleLanguage: TitleLanguage
  /** The ids ticked so far. Kept by App, in memory only (#61). */
  picked: ReadonlySet<number>
  /** What narrows and orders the rows (#65); `DEFAULT_PICKER_FILTERS` when left out. In memory only, like the picks. */
  filters?: PickerFilters
}

/** The Picker's filters, search and sort (#65). None of them touches the picks: a hidden pick stays picked. */
export type PickerFilters = {
  /** The list statuses shown, out of those Start offers. */
  statuses: readonly ListStatus[]
  /** Text typed in the search box, matched against the title in the user's title language. */
  search: string
  /** One release year, or null for all years (the only choice that shows titles without a year). */
  year: number | null
  /** Genres and tags a title must all have to show (#65). */
  genres: readonly string[]
  tags: readonly string[]
  sort: PickerSort
  /** "Picked only": just the picked titles (that pass the other filters). */
  pickedOnly: boolean
  /** Text typed in the tag choice's own search box; it narrows the tags offered, not the rows. */
  tagSearch: string
}

/**
 * How the rows are ordered. `default`: titles without a score first, then the most recently completed, then by title.
 * `title`; `score`: highest first, titles without a score last; `year`: release year, newest first, none last.
 */
export type PickerSort = 'default' | 'title' | 'score' | 'year'

/** A genre or tag the Picker offers, with the count of titles shown once it is chosen too. */
export type PickerFacet = { name: string; count: number; chosen: boolean }

/** A tag counts for a title from this rank up (#61); below it AniList's voters barely agree it applies. */
export const MIN_TAG_RANK = 50

/** What the Picker opens with: Completed and Repeating, the titles the user is most able to judge (#61). */
export const DEFAULT_PICKER_FILTERS: PickerFilters = {
  statuses: DEFAULT_STATUSES,
  search: '',
  year: null,
  genres: [],
  tags: [],
  sort: 'default',
  pickedOnly: false,
  tagSearch: '',
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
 * What Confirm starts a Keep My Scale Ranking on: the picked titles in the order its Duels meet them (most recently
 * completed first, then by title) and the Anchor snapshot, which never holds a picked title.
 */
export type PickerStart = { order: number[]; anchors: AnchorScore[] }

/** Whether Confirm may start a Keep My Scale Ranking, and on what. When it may not, the reason as the Picker shows it. */
export type PickerConfirm = ({ allowed: true } & PickerStart) | { allowed: false; reason: string }

export type PickerView = {
  /** The rows shown, in order. */
  rows: PickerRow[]
  summary: PickerSummary
  confirm: PickerConfirm
  /** How many titles of each status the status filter offers there are on the list, whatever the other filters (#67). */
  statusCounts: Partial<Record<ListStatus, number>>
  /** The release years the year filter offers: those of every title the Picker can list, newest first. */
  years: number[]
  /** Every genre on the titles the Picker can list, by name. */
  genres: PickerFacet[]
  /**
   * The tags offered: every tag that counts for a title the Picker can list, never a spoiler one, narrowed by the tag
   * search. The chosen ones first, then the most common, then by name.
   */
  tags: PickerFacet[]
  /** How many tags are offered before the tag search narrows them, for the tag search box (#67). */
  tagCount: number
  /**
   * What "Add N without a score" adds: the unscored titles not yet picked that the status, year, genre and tag filters
   * show. The search box is ignored (#61 story 26), so a forgotten search never makes it add fewer than it says.
   */
  addUnscored: number[]
  /** "Pick all N shown": how many titles are shown (search included) and which of them aren't picked yet. */
  pickAll: { shown: number; ids: number[] }
  /**
   * Null while titles show. With none shown, each single change that would bring titles back and how many it would
   * show, in the order clear the search, every list status, all years, clear genres and tags, turn "Picked only" off;
   * a change that would show none is left out. Resetting the search and every filter (`wayOut(filters, 'reset')`) is
   * always there too.
   */
  nothingMatches: { change: PickerChange; count: number }[] | null
  /**
   * How many filters are on, for the badge on the phone's filters button (#67): each list status shown, the year, and
   * each chosen genre and tag. The search box and the sort sit outside that button and don't count.
   */
  activeFilters: number
  /** What the dock at the bottom shows beside the summary (#67). */
  dock: PickerDock
}

/** The dock's own outputs (#67): what the summary's numbers don't say. */
export type PickerDock = {
  /** How many picks have a score, which their Ranking will replace. */
  replacing: number
  /** The covers stacked in the dock: the last titles picked, the latest first, at most `DOCK_COVERS`. */
  covers: ListEntry[]
  /**
   * Null while Confirm is allowed. Otherwise the line the dock shows in place of the Anchors left, `confirm.reason`:
   * plain with nothing picked, a warning when the picks leave too few Anchors or scores.
   */
  blocked: { text: string; warn: boolean } | null
}

/** How many covers the dock stacks. */
export const DOCK_COVERS = 6

/** A way out of "nothing matches". */
export type PickerChange = 'search' | 'statuses' | 'years' | 'genres-tags' | 'picked-only'

/** The filters after taking a way out of "nothing matches", or after resetting them all (the sort is kept). */
export function wayOut(filters: PickerFilters, change: PickerChange | 'reset'): PickerFilters {
  switch (change) {
    case 'search':
      return { ...filters, search: '' }
    case 'statuses':
      return { ...filters, statuses: OFFERED_STATUSES }
    case 'years':
      return { ...filters, year: null }
    case 'genres-tags':
      return { ...filters, genres: [], tags: [] }
    case 'picked-only':
      return { ...filters, pickedOnly: false }
    case 'reset':
      return { ...DEFAULT_PICKER_FILTERS, sort: filters.sort }
  }
}

const CHANGES: readonly PickerChange[] = ['search', 'statuses', 'years', 'genres-tags', 'picked-only']

/** The filters with a genre or tag chosen, or taken out if it was chosen. */
export function toggleFacet(filters: PickerFilters, key: 'genres' | 'tags', name: string): PickerFilters {
  const chosen = filters[key]
  return { ...filters, [key]: chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name] }
}

/** The filters with a list status shown, or hidden if it was shown; kept in the order Start offers them. */
export function toggleStatus(filters: PickerFilters, status: ListStatus): PickerFilters {
  const on = filters.statuses.includes(status)
  return { ...filters, statuses: OFFERED_STATUSES.filter((s) => (s === status ? !on : filters.statuses.includes(s))) }
}

/**
 * How the Picker was opened, which decides its starting picks. From Start nothing is ticked (#64); Catch-up's exit
 * offer (#65) adds its own way in here. The remembered unsettled titles (#66) come on top of any way in.
 */
export type PickerWayIn = { from: 'start' } | { from: 'catch-up' }

/**
 * The picks the Picker opens with: those of the way it was opened, plus the remembered unsettled titles when the user
 * chose to pick them again (#66), leaving out any the Picker can't show.
 */
export function startingPicks(
  list: readonly ListEntry[],
  format: ScoreFormat,
  wayIn: PickerWayIn,
  remembered: readonly number[] = [],
): Set<number> {
  const shown = new Set(pickable(list).map((e) => e.mediaId))
  return new Set([...picksOfWayIn(list, format, wayIn), ...remembered.filter((id) => shown.has(id))])
}

/** The picks the way in ticks by itself. */
function picksOfWayIn(list: readonly ListEntry[], format: ScoreFormat, wayIn: PickerWayIn): Set<number> {
  switch (wayIn.from) {
    case 'start':
      return new Set()
    case 'catch-up':
      // Every unscored Completed and Repeating title, the ones just added among them, as the offer's label counts (#65).
      return new Set(unscoredTitles(list, format).map((e) => e.mediaId))
  }
}

/** The picks after one click on a title: ticked if it wasn't, unticked if it was. */
export function togglePick(picked: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(picked)
  if (!next.delete(id)) next.add(id)
  return next
}

/** The picks with these titles added ("Add N without a score", "Pick all N shown"). */
export function addPicks(picked: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  return new Set([...picked, ...ids])
}

/** The titles the Picker can offer: every title on the list except Planning ones (ADR 0011). */
function pickable(list: readonly ListEntry[]): ListEntry[] {
  return list.filter((e) => e.status !== 'PLANNING')
}

/** Lower case without accents, so "pokemon" finds "Pokémon". */
function folded(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

/** The tags that count for a title: never a spoiler one, and only from `MIN_TAG_RANK` up. */
function tagsOf(entry: ListEntry): string[] {
  return (entry.tags ?? []).filter((t) => !t.spoiler && t.rank >= MIN_TAG_RANK).map((t) => t.name)
}

/** How many times each name occurs. */
function countsOf(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return counts
}

/** Each title's folded name per title language, kept while the list is, since the search runs on every keystroke. */
const foldedNames = new WeakMap<ListEntry, Map<TitleLanguage, string>>()
function foldedName(entry: ListEntry, language: TitleLanguage): string {
  let names = foldedNames.get(entry)
  if (!names) foldedNames.set(entry, (names = new Map()))
  let name = names.get(language)
  if (name === undefined) names.set(language, (name = folded(displayTitle(entry.title, language))))
  return name
}

/** Whether a title passes the filters and the search. */
function matches(entry: ListEntry, filters: PickerFilters, language: TitleLanguage, picked: ReadonlySet<number>): boolean {
  if (filters.pickedOnly && !picked.has(entry.mediaId)) return false
  if (!filters.statuses.includes(entry.status)) return false
  if (filters.year !== null && entry.year !== filters.year) return false
  const genres = entry.genres ?? []
  if (!filters.genres.every((g) => genres.includes(g))) return false
  if (filters.tags.length > 0) {
    const tags = tagsOf(entry)
    if (!filters.tags.every((t) => tags.includes(t))) return false
  }
  const search = folded(filters.search)
  return search === '' || foldedName(entry, language).includes(search)
}

/**
 * Most recently completed first, undated last, then by title. The order Rough Sort shows titles in (issue #4),
 * borrowed for the order alone: a Keep My Scale Ranking has no Rough Sort.
 */
const newestCompletedFirst = roughSortOrder

/** The default order: titles without a score first, then the most recently completed first, then by title. */
function defaultOrder(entries: readonly ListEntry[], format: ScoreFormat, language: TitleLanguage): ListEntry[] {
  const byId = new Map(entries.map((e) => [e.mediaId, e]))
  const ordered = newestCompletedFirst(entries, language).map((id) => byId.get(id)!)
  return [...ordered.filter((e) => !hasScore(e, format)), ...ordered.filter((e) => hasScore(e, format))]
}

/** The rows' titles in order for a sort; ties go by title. */
function sorted(entries: readonly ListEntry[], sort: PickerSort, format: ScoreFormat, language: TitleLanguage): ListEntry[] {
  if (sort === 'default') return defaultOrder(entries, format, language)
  const named = entries.map((entry) => ({ entry, name: displayTitle(entry.title, language) }))
  // Missing scores and years sort last: 0 (no score) and -Infinity (no year) under a highest-first order.
  const key = (e: ListEntry) => (sort === 'score' ? e.oldScore100 : sort === 'year' ? (e.year ?? -Infinity) : 0)
  return named
    .sort((a, b) => key(b.entry) - key(a.entry) || a.name.localeCompare(b.name))
    .map(({ entry }) => entry)
}

export function pickerView(input: PickerInput): PickerView {
  const { list, scoreFormat, titleLanguage, picked, filters = DEFAULT_PICKER_FILTERS } = input
  const shown = pickable(list).filter((e) => matches(e, filters, titleLanguage, picked))
  const rows = sorted(shown, filters.sort, scoreFormat, titleLanguage).map((entry): PickerRow => {
    return {
      entry,
      title: displayTitle(entry.title, titleLanguage),
      score: hasScore(entry, scoreFormat) ? formatLevel(scoreFormat, levelOfRaw(scoreFormat, entry.oldScore100)) : null,
      year: entry.year,
      status: entry.status,
      picked: picked.has(entry.mediaId),
    }
  })
  const pickedEntries = pickable(list).filter((e) => picked.has(e.mediaId))
  const pickedIds = new Set(pickedEntries.map((e) => e.mediaId))
  // Every scored title is an Anchor, Planning ones included (ADR 0009), except the picks: `list` is read with them.
  const anchors = anchorsOf(list, scoreFormat, pickedIds)
  const left = keepMyScaleEligibility(anchors)
  const summary: PickerSummary = {
    picked: pickedEntries.length,
    anchors: left.anchors,
    scores: left.scores,
    duels: estimateKeepMyScaleDuels(pickedEntries.length, left.scores),
  }
  const shownWith = (next: PickerFilters) => pickable(list).filter((e) => matches(e, next, titleLanguage, picked)).length
  // Choosing one more genre or tag only narrows, so its count is how many titles shown now have it: one pass, not one
  // per genre or tag, which keeps a list with hundreds of tags fast.
  const genreCounts = countsOf(shown.flatMap((e) => e.genres ?? []))
  const tagCounts = countsOf(shown.flatMap(tagsOf))
  const facet = (name: string, chosen: readonly string[], counts: ReadonlyMap<string, number>): PickerFacet => {
    const isChosen = chosen.includes(name)
    return { name, chosen: isChosen, count: isChosen ? shown.length : (counts.get(name) ?? 0) }
  }
  const genreNames = new Set([...pickable(list).flatMap((e) => e.genres ?? []), ...filters.genres])
  const genres = [...genreNames].sort((a, b) => a.localeCompare(b)).map((name) => facet(name, filters.genres, genreCounts))
  const tagSearch = folded(filters.tagSearch)
  const tagNames = new Set([...pickable(list).flatMap(tagsOf), ...filters.tags])
  const tags = [...tagNames]
    .filter((name) => filters.tags.includes(name) || folded(name).includes(tagSearch))
    .map((name) => facet(name, filters.tags, tagCounts))
    .sort((a, b) => Number(b.chosen) - Number(a.chosen) || b.count - a.count || a.name.localeCompare(b.name))
  const unsearched = { ...filters, search: '', pickedOnly: false }
  const addUnscored = sorted(pickable(list), 'default', scoreFormat, titleLanguage)
    .filter((e) => !hasScore(e, scoreFormat) && !picked.has(e.mediaId) && matches(e, unsearched, titleLanguage, picked))
    .map((e) => e.mediaId)
  const pickAll = { shown: rows.length, ids: rows.filter((r) => !r.picked).map((r) => r.entry.mediaId) }
  const nothingMatches =
    rows.length > 0
      ? null
      : CHANGES.map((change) => ({ change, count: shownWith(wayOut(filters, change)) })).filter((w) => w.count > 0)
  const years = [...new Set(pickable(list).flatMap((e) => (e.year === null ? [] : [e.year])))].sort((a, b) => b - a)
  // The picks keep the order they were ticked in (a Set keeps insertion order), so the latest are at the end.
  const byId = new Map(pickedEntries.map((e) => [e.mediaId, e]))
  const latest = [...picked].flatMap((id) => byId.get(id) ?? []).reverse()
  const statusCounts = Object.fromEntries(OFFERED_STATUSES.map((status) => [status, 0]))
  for (const e of pickable(list)) if (e.status in statusCounts) statusCounts[e.status]++
  const confirm = confirmOf(pickedEntries, anchors, left, titleLanguage)
  const dock: PickerDock = {
    replacing: pickedEntries.filter((e) => hasScore(e, scoreFormat)).length,
    covers: latest.slice(0, DOCK_COVERS),
    blocked: confirm.allowed ? null : { text: confirm.reason, warn: pickedEntries.length > 0 },
  }
  return {
    rows,
    summary,
    confirm,
    years,
    genres,
    tags,
    addUnscored,
    pickAll,
    nothingMatches,
    dock,
    statusCounts,
    tagCount: tagNames.size,
    activeFilters: filters.statuses.length + (filters.year === null ? 0 : 1) + filters.genres.length + filters.tags.length,
  }
}

function confirmOf(picked: readonly ListEntry[], anchors: AnchorScore[], left: KeepMyScaleEligibility, language: TitleLanguage): PickerConfirm {
  if (picked.length === 0) return { allowed: false, reason: 'Pick at least one title.' }
  if (!left.eligible) {
    return {
      allowed: false,
      reason:
        `Your picks leave ${count(left.anchors, 'Anchor')} on ${count(left.scores, 'score')}; ` +
        `at least ${MIN_ANCHORS} on ${MIN_ANCHOR_SCORES} are needed. Untick some titles that have a score.`,
    }
  }
  return { allowed: true, order: newestCompletedFirst(picked, language), anchors }
}
