// Ranking Engine (ADR 0001, ADR 0005): pure, no I/O. The Duel log is the source of truth;
// every derived thing (next prompt, the Ranking, progress) is rebuilt by replaying it.
import type { MediaType, ScoreFormat } from '../anilist/types.ts'
import { sideHash } from './hash.ts'
import { intervalOf, knowledgeOf, nextLevelDuel, tierIndex, type LevelContext, type PositionRange, type SegmentKnowledge } from './levelSelect.ts'
import {
  addNewTitles,
  excludeAnchor,
  includeAnchor,
  answerAnchorDuel,
  newTitlesView,
  nextAnchorDuel,
  returnNewTitle,
  startNewTitles,
  takeOutNewTitle,
  type AnchorScore,
  type NewTitles,
  type NewTitlesState,
} from './newTitles.ts'
import { defaultSettings, levelAt, parseSavedScoring, type SavedScoring, type ScoringSettings } from './scoring.ts'

export const LOG_FORMAT_VERSION = 1
/**
 * The engine version stamped on a log's header. Every version replays every older log exactly as the older one
 * did, so all of 1..ENGINE_VERSION are accepted, but a log may not contain events newer than its header says
 * (`EVENT_RULES[type].since`). `appendEvent` stamps the current version, so an older app refuses a log it would
 * replay differently (ADR 0005). Adding an event kind or changing replay means bumping this and, for a new kind,
 * adding its row to `EVENT_RULES`. 2 also allowed `sub` on `band-assigned` (ADR 0006).
 */
export const ENGINE_VERSION = 8
const KNOWN_ENGINE_VERSIONS: readonly number[] = Array.from({ length: ENGINE_VERSION }, (_, i) => i + 1)

/** Band index: 0 = Loved (top) … 4 = Hated (bottom). There are always five Bands. */
export type BandIndex = 0 | 1 | 2 | 3 | 4
export const BANDS: readonly BandIndex[] = [0, 1, 2, 3, 4]
/** One value per Band, indexed by BandIndex (Loved first). */
export type PerBand<T> = [T, T, T, T, T]

/** Sub-band index inside a split Band (ADR 0006): 0 = Best, 1 = Middle, 2 = Lowest. */
export type SubBandIndex = 0 | 1 | 2
export const SUB_BANDS: readonly SubBandIndex[] = [0, 1, 2]

export type LogHeader = {
  format: number
  engine: number
  seed: number
  userId: number
  mediaType: MediaType
}

export type DuelResult = 'a' | 'b' | 'tie'

/**
 * Sort Goal (ADR 0007): stop a title's Duels once its score level is settled, or give every title its own place.
 * Score New Titles (ADR 0009) scores only unscored titles against Anchors; only `anchors-set` starts it, and a Ranking
 * on it never switches.
 */
export type SortGoal = 'scores' | 'full-ranking' | 'score-new-titles'
/** The Sort Goals `sort-goal-set` can switch between (ADR 0007). */
export type SwitchableGoal = Exclude<SortGoal, 'score-new-titles'>
const SWITCHABLE_GOALS: readonly SwitchableGoal[] = ['scores', 'full-ranking']

export type { AnchorScore, AnchorLevel, NewTitle, NewTitlesState } from './newTitles.ts'

export type LogEvent =
  /** Titles joining the Pool (the first Pool load, or a sync): they go to the back of the Rough Sort queue. */
  | { type: 'titles-added'; ids: number[] }
  /**
   * Titles leaving the Pool (a sync, ADR 0005): taken out of wherever they are, Forgotten included. A title
   * added again later is a new title and starts from Rough Sort.
   */
  | { type: 'titles-removed'; ids: number[] }
  /** `sub` is required when the Band is split (the second tap in Rough Sort) and refused when it isn't. */
  | { type: 'band-assigned'; id: number; band: BandIndex; sub?: SubBandIndex }
  /** A Duel answer, by id (ADR 0005): `result` names the better title, or 'tie' for "about the same". */
  | { type: 'duel-answered'; a: number; b: number; result: DuelResult }
  | { type: 'forgotten'; id: number }
  /**
   * The whole split of one Band into three Sub-bands, as one user event (ADR 0006).
   * `cuts` are Tier indexes into the Band's Ranking at that moment: Best = Tiers [0, cuts[0]), Middle =
   * [cuts[0], cuts[1]), Lowest = [cuts[1], end). A cut is a Tier index, so it always falls on a Tier edge.
   * `unplaced` lists, per Sub-band, the titles without a place yet. Together they must be exactly the Band's
   * insertion queue; inside a Sub-band they keep the order they had in that queue.
   */
  | { type: 'band-split'; band: BandIndex; cuts: [number, number]; unplaced: [number[], number[], number[]] }
  /**
   * Navigation (ADR 0005): Duels go on in this Band until it has no title left to place.
   * Ignored while Rough Sort isn't done or when the Band has nothing to place. Undo skips over it.
   */
  | { type: 'band-selected'; band: BandIndex }
  /**
   * Fixing the Ranking (ADR 0005). `band-moved` takes a title out of its Band (or Sub-band) and
   * puts it at the front of another one's insertion queue; `sub` follows the `band-assigned` rule (required for a
   * split Band, refused otherwise). It may name another Sub-band of the same Band.
   */
  | { type: 'band-moved'; id: number; band: BandIndex; sub?: SubBandIndex }
  /** Takes a title out of its place and puts it at the front of its own (Sub-)band's insertion queue. */
  | { type: 'rerank-requested'; id: number }
  /**
   * Brings a Forgotten title back: to the front of the (Sub-)band it was last in, or to the front of the Rough Sort
   * queue if it never had one, or if its Band was split since (so the second tap asks for the Sub-band).
   */
  | { type: 'unforgotten'; id: number }
  /**
   * Rough Sort from Scores (ADR 0008): the Band of every title the app placed from its old AniList score, as one
   * user event. `bands[b]` lists, by id, the titles that go to the back of Band b's insertion queue, in that order.
   * Each must be waiting in Rough Sort; titles it doesn't list stay there. Replay never reads AniList scores.
   */
  | { type: 'bands-from-scores'; bands: PerBand<number[]> }
  /**
   * The Sort Goal from here on (ADR 0007). A log without one is Full Ranking. A setting, not a user event: Undo
   * skips it (never cancels it, never stops at it, never cancels it along with a later Undo).
   */
  | { type: 'sort-goal-set'; goal: SwitchableGoal }
  /**
   * The scoring settings from here on, with the Score Format they are on (ADR 0007): changed on Preview, or
   * converted after the Score Format changed on AniList (ADR 0003). A log without one uses the scoring settings
   * saved outside it. Undo skips it, like `sort-goal-set`.
   */
  | { type: 'scoring-set'; format: ScoreFormat; settings: ScoringSettings }
  /**
   * Starts a Score New Titles Ranking (ADR 0009): the Sort Goal, and the snapshot of every Anchor with its score as a
   * level of `format` at that time. Only before any title and any Sort Goal; replay never reads AniList scores. Titles
   * added after it are the new titles, never an Anchor. Undo never reaches past it.
   */
  | { type: 'anchors-set'; format: ScoreFormat; anchors: AnchorScore[] }
  | { type: 'undo' }

export type DuelLog = { header: LogHeader; events: LogEvent[] }

/** Every event except Undo itself: what Undo can cancel, and what the engine applies. */
type RecordedEvent = Exclude<LogEvent, { type: 'undo' }>

/**
 * How Undo treats an event (ADR 0005): user events can be cancelled; system (sync) events are a barrier that Undo
 * never reaches past; navigation (`band-selected`) is skipped over, neither a step nor a barrier, but goes with
 * a cancelled event before it; settings (ADR 0007) are skipped over and never cancelled at all.
 */
type UndoRole = 'user' | 'barrier' | 'navigation' | 'setting'

/**
 * One row per event kind: the engine version it came with (a log whose header is older refuses it), its name in
 * that error, and its Undo role. Engine version 2 came with `band-split`, 3 with `band-selected`, 4 with
 * `titles-removed`, 5 with the fixes (`band-moved`, `rerank-requested`, `unforgotten`), 6 with `bands-from-scores`,
 * 7 with the Sort Goal and scoring settings (`sort-goal-set`, `scoring-set`, ADR 0007), 8 with
 * Score New Titles (`anchors-set`, ADR 0009).
 */
const EVENT_RULES: { readonly [K in RecordedEvent['type']]: { since: number; name: string; undoRole: UndoRole } } = {
  'titles-added': { since: 1, name: 'Titles added', undoRole: 'barrier' },
  'titles-removed': { since: 4, name: 'Titles removed', undoRole: 'barrier' },
  'band-assigned': { since: 1, name: 'Band assigned', undoRole: 'user' },
  'duel-answered': { since: 1, name: 'Duel answered', undoRole: 'user' },
  forgotten: { since: 1, name: 'Forgotten', undoRole: 'user' },
  'band-split': { since: 2, name: 'Band split', undoRole: 'user' },
  'band-selected': { since: 3, name: 'Band selected', undoRole: 'navigation' },
  'band-moved': { since: 5, name: 'Band moved', undoRole: 'user' },
  'rerank-requested': { since: 5, name: 'Re-rank requested', undoRole: 'user' },
  unforgotten: { since: 5, name: 'Unforgotten', undoRole: 'user' },
  'bands-from-scores': { since: 6, name: 'Bands from scores', undoRole: 'user' },
  'sort-goal-set': { since: 7, name: 'Sort Goal set', undoRole: 'setting' },
  'scoring-set': { since: 7, name: 'Scoring settings set', undoRole: 'setting' },
  'anchors-set': { since: 8, name: 'Anchors set', undoRole: 'barrier' },
}

/**
 * Events that have no meaning under Score New Titles (no Rough Sort, no Bands, no switching, ADR 0009): refused
 * there. `rerank-requested` has no Score New Titles meaning yet either.
 */
const NOT_ON_NEW_TITLES: ReadonlySet<RecordedEvent['type']> = new Set([
  'band-assigned',
  'band-split',
  'band-selected',
  'band-moved',
  'rerank-requested',
  'bands-from-scores',
  'sort-goal-set',
])

export type Prompt =
  | { kind: 'rough-sort'; id: number }
  | {
      kind: 'duel'
      band: BandIndex
      /** Only present when the Band is split: the Sub-band this Duel is in. */
      sub?: SubBandIndex
      /** The title being inserted. */
      a: number
      /** Its opponent: the pivot Tier's first-inserted member that is still present. */
      b: number
      /** Display only (ADR 0005): `hash(seed, min, max)` decides which card is on the left. */
      left: number
      right: number
      /**
       * Full Ranking only (binary insertion; left out under Scores). Where the insertion stands, as Tier indexes
       * into `bands[band].tiers` (the whole Band, also when it is split): the title belongs somewhere in lo..hi
       * (between Tier lo-1 and Tier hi), and `pivot` is the Tier it is compared with now.
       */
      bounds?: { lo: number; hi: number; pivot: number }
      /**
       * Scores only: a Refine Duel (GLOSSARY), asked because something moved a level boundary after every score
       * had been settled once (a settings change, sync, Forgotten, Band move, Re-rank). Display only.
       */
      refine?: true
    }
  /**
   * Score New Titles (ADR 0009): new title `a` against Anchor `b`, answered with `duel-answered` like any Duel.
   * `left` / `right` are display only, as for a Duel; nothing on screen says which side is the Anchor.
   */
  | { kind: 'anchor-duel'; a: number; b: number; left: number; right: number }
  | { kind: 'all-complete' }

export type SubBandState = {
  /** The Ranking inside this Sub-band: Tiers best first. */
  tiers: readonly (readonly number[])[]
  /** Titles in this Sub-band without a place yet, in insertion order (the first is in progress). */
  unplaced: readonly number[]
}

export type BandState = {
  /**
   * The Ranking inside this Band: Tiers best first, each Tier's titles in the order they joined it.
   * For a split Band these are its Sub-bands' Tiers one after another (Best, Middle, Lowest), so it is still
   * the whole Band's order.
   */
  tiers: readonly (readonly number[])[]
  /**
   * Titles in this Band without a place yet, in the order they will be inserted (the first is in progress). Under
   * Scores these include titles whose level is settled but whose exact place was never asked (see `standing`).
   */
  unplaced: readonly number[]
  /** Only present once the Band is split (ADR 0006): Best, Middle, Lowest. */
  subBands?: readonly [SubBandState, SubBandState, SubBandState]
}

export type Progress = { done: number; total: number }

/**
 * A Band's or Sub-band's progress: titles that need no more Duels (with a place on Full Ranking, settled on Scores)
 * out of all its titles. `progress.bands` holds the same per Band.
 */
export function progressOf(state: Pick<RankingState, 'standing'>, part: SubBandState): Progress {
  const total = titlesIn(part)
  const settled = state.standing?.settled
  if (!settled) return { done: total - part.unplaced.length, total }
  let done = 0
  for (const tier of part.tiers) for (const id of tier) if (settled.has(id)) done++
  for (const id of part.unplaced) if (settled.has(id)) done++
  return { done, total }
}

/** Every title in a Band or Sub-band: in its Tiers and without a place. */
export function titlesIn(part: { readonly tiers: readonly (readonly unknown[])[]; readonly unplaced: readonly unknown[] }): number {
  return part.tiers.reduce((sum, tier) => sum + tier.length, 0) + part.unplaced.length
}

/**
 * Under Scores (ADR 0007): what the Duels so far say about every title in a Band. Its levels come from `score`;
 * titles in a Tier and titles without a place alike have a range of positions, and a title is settled when every
 * position in it gives one level.
 */
export type Standing = {
  /** Titles in a Band, the n the Distribution spreads over (Rough Sort and Forgotten titles not counted). */
  size: number
  /**
   * Every title in a Band, Band by Band from the top (Tiers in order, then titles without a place): the Tier-average
   * positions (0 = best, among `size`) it can still end up at.
   */
  titles: ReadonlyMap<number, PositionRange & { band: BandIndex }>
  /** The titles whose level, under the log's scoring settings, no further Duel can change. */
  settled: ReadonlySet<number>
}

export type RankingState = {
  prompt: Prompt
  bands: readonly BandState[]
  /** Forgotten titles, in the order they were marked. */
  forgotten: readonly number[]
  progress: {
    roughSort: Progress
    /** Per Band: titles with a place in the Ranking (under Scores: settled titles) / titles in the Band. */
    bands: readonly Progress[]
    /** Over every Band. */
    ranked: Progress
  }
  /**
   * A Band choice is due: Rough Sort is done, some Band still has titles to place, and no Band is being worked
   * on (right after Rough Sort, or because the chosen Band just finished). `finished` is the Band that just
   * finished (null right after Rough Sort); `next` is the default, the top Band with titles to place, which is
   * also the Band the Duel prompt is in until a `band-selected` picks another.
   */
  bandChoice: { finished: BandIndex | null; next: BandIndex } | null
  /** Whether an Undo appended now would cancel anything. */
  canUndo: boolean
  board: BoardView
  /**
   * The latest `sort-goal-set`. Left out when the log has none (an older log, ADR 0007): that means Full Ranking.
   * (Left out rather than defaulted, so a state compares equal to one replayed before these events existed.)
   */
  sortGoal?: SortGoal
  /**
   * The latest `scoring-set`. Left out when the log has none: then the scoring settings saved outside the log apply
   * (older logs, ADR 0007). Its Score Format may differ from AniList's now: see `scoringFor`.
   */
  scoring?: SavedScoring
  /** Only under Scores: each title's possible positions and whether it is settled. */
  standing?: Standing
  /** Only under Score New Titles (ADR 0009): the Anchor levels and where every new title stands. */
  newTitles?: NewTitlesState
}

/** One title on the Board: `at` is the position of the event that last put it in its Band; `sub` only in a split Band. */
export type BoardTitle = { id: number; at: number; sub?: SubBandIndex }

/** The Board: every title that has a Band, by Band. Display only, it never changes what the log replays to. */
export type BoardView = {
  /** Open while no Duel answer is in effect: during Rough Sort and right after it. */
  open: boolean
  /**
   * Index = BandIndex, Loved first. Titles most recently put in the Band first. Titles put there by the same event
   * share `at` and are listed by id here; the UI orders those by display name.
   */
  bands: readonly { titles: readonly BoardTitle[] }[]
}

/** The log can't be replayed: unknown version, or an event that doesn't fit the state it lands on. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayError'
  }
}

/**
 * A new log for a first Pool load: the header plus one `titles-added` event in Rough Sort order. Given the user's
 * Score Format, the log starts on Scores with that format's default scoring settings on the whole Score Step
 * (ADR 0007), so it never depends on settings saved outside it. The settings come first: Scores needs them.
 */
export function startLog(options: {
  seed: number
  userId: number
  mediaType: MediaType
  ids: readonly number[]
  scoreFormat?: ScoreFormat
}): DuelLog {
  const { seed, userId, mediaType, ids, scoreFormat } = options
  const settings: LogEvent[] = scoreFormat
    ? [
        { type: 'scoring-set', format: scoreFormat, settings: defaultSettings(scoreFormat, 'whole') },
        { type: 'sort-goal-set', goal: 'scores' },
      ]
    : []
  return {
    header: { format: LOG_FORMAT_VERSION, engine: ENGINE_VERSION, seed, userId, mediaType },
    events: [...settings, { type: 'titles-added', ids: [...ids] }],
  }
}

/**
 * A new Score New Titles log (ADR 0009): the header, the default scoring settings (unused by this Sort Goal, but
 * Preview and Import read the Score Format from them as on every other log), the Anchor snapshot, then the new titles.
 */
export function startNewTitlesLog(options: {
  seed: number
  userId: number
  mediaType: MediaType
  format: ScoreFormat
  anchors: readonly AnchorScore[]
  ids: readonly number[]
}): DuelLog {
  const { seed, userId, mediaType, format, anchors, ids } = options
  return {
    header: { format: LOG_FORMAT_VERSION, engine: ENGINE_VERSION, seed, userId, mediaType },
    events: [
      { type: 'scoring-set', format, settings: defaultSettings(format, 'whole') },
      { type: 'anchors-set', format, anchors: anchors.map(({ id, level }) => ({ id, level })) },
      { type: 'titles-added', ids: [...ids] },
    ],
  }
}

/**
 * Appends one event and stamps the current engine version on the header. This engine replays every older log
 * the same way, so the upgrade is safe, and it stops an older app from silently ignoring events it doesn't know.
 */
export function appendEvent(log: DuelLog, event: LogEvent): DuelLog {
  return { header: { ...log.header, engine: ENGINE_VERSION }, events: [...log.events, event] }
}

/** Titles the user considers equal. Members in the order they joined; the first is the Tier's face on a card. */
type Tier = { members: number[] }

/**
 * A title waiting for, or in the middle of, its binary insertion. Bounds are Tiers (by identity), so they
 * survive other titles being taken out: `above` is the Tier it is known to be worse than, `below` the Tier
 * it is known to be better than (null = the edge of the Segment).
 */
type Insertion = { id: number; above: Tier | null; below: Tier | null }

/**
 * A fixed boundary in the Ranking that Duels never cross: a Band, or a Sub-band of a split Band (ADR 0006).
 * It holds its own ordered Tiers and its own insertion queue (the front one is in progress).
 */
type Segment = { tiers: Tier[]; queue: Insertion[] }

type Machine = {
  /** The log header's engine version: events that came with a later version are refused. */
  engine: number
  roughSortQueue: number[]
  /** Per Band: one Segment, or three (Best, Middle, Lowest) once it is split. */
  bands: Segment[][]
  /** Every Segment of every Band, top to bottom (`bands` flattened; rebuilt when a Band is split). */
  segments: Segment[]
  forgotten: number[]
  /** Every title currently in the log's Pool (Rough Sort queue, a Band, or Forgotten). */
  present: Set<number>
  total: number
  /** The Band Duels are worked on in (chosen, or the one a Duel was answered in); null while a choice is due. */
  focus: BandIndex | null
  /** The Band whose last title was just placed while it had the focus; null right after Rough Sort. */
  finished: BandIndex | null
  /** The (Sub-)band each title in a Band is in, kept after it is Forgotten so Unforgotten can send it back. */
  lastPlace: Map<number, Place>
  /**
   * A title sent to the front of a queue by a fix (move, Re-rank, Unforgotten) is placed straight away; then Duels
   * go back to where they were (`resume`). Null when no fix is being placed.
   */
  detour: { id: number; band: BandIndex; sub?: SubBandIndex; resume: Resume } | null
  /** Unforgotten titles waiting in Rough Sort (no usable last Sub-band): the detour starts once they are sorted. */
  returning: Map<number, Resume>
  /** The position (among the events that still count) of the event being applied now. */
  step: number
  /** For the Board: the position of the event that last put each title in its Band. */
  placedAt: Map<number, number>
  /** Whether any title has had its Band chosen by hand (assigned in Rough Sort, or moved): no Rough Sort from Scores after that. */
  placedByHand: boolean
  sortGoal: SortGoal | null
  scoring: SavedScoring | null
  seed: number
  /**
   * Under Scores only: the layout and each Segment's knowledge, worked out once and dropped after an event that may
   * change them (nothing in between changes a Segment). `layout` undefined = not worked out yet. Never read on Full
   * Ranking, so it is not kept up to date there.
   */
  scoresCache: { layout?: ScoresLayout; knowledge: Map<Segment, SegmentKnowledge> }
  /** The Segment the event being applied answered a Duel in (null for any other event). */
  answeredIn: Segment | null
  /** Whether every score was settled on Scores at some point: Duels on Scores after that are Refine Duels. */
  settledOnce: boolean
  /** Under Score New Titles only (ADR 0009): the Anchors and every new title's search. */
  newTitles: NewTitles | null
}

type Place = { band: BandIndex; sub?: SubBandIndex }
type Resume = { focus: BandIndex | null; finished: BandIndex | null }

/**
 * `intervalOf` (levelSelect.ts) for one insertion of a Segment, finding Tiers by `indexOf`. Written out rather than
 * passing a closure: Full Ranking calls it after every event of every replay.
 */
function insertionInterval(segment: Segment, insertion: Insertion): { lo: number; hi: number } {
  const lo = insertion.above ? segment.tiers.indexOf(insertion.above) + 1 : 0
  const hi = insertion.below ? segment.tiers.indexOf(insertion.below) : segment.tiers.length
  return { lo, hi }
}

/**
 * Full Ranking: gives a place to every front insertion whose interval is empty (it needs no more Duels), in queue
 * order. Stops at the first front insertion that still needs a Duel.
 */
function placeEmptyFronts(segment: Segment): void {
  for (let front = segment.queue[0]; front; front = segment.queue[0]) {
    const { lo, hi } = insertionInterval(segment, front)
    if (lo < hi) return
    segment.queue.shift()
    segment.tiers.splice(lo, 0, { members: [front.id] })
  }
}

/** Takes a title out of wherever it is (Rough Sort queue, an insertion queue, or a Tier). Every other title keeps its order. */
function takeOut(machine: Machine, id: number): void {
  if (machine.newTitles) takeOutNewTitle(machine.newTitles, id)
  const waiting = machine.roughSortQueue.indexOf(id)
  if (waiting >= 0) machine.roughSortQueue.splice(waiting, 1)
  for (const segment of machine.segments) {
    const queued = segment.queue.findIndex((insertion) => insertion.id === id)
    if (queued >= 0) segment.queue.splice(queued, 1)
    const t = segment.tiers.findIndex((tier) => tier.members.includes(id))
    if (t < 0) continue
    const tier = segment.tiers[t]
    tier.members.splice(tier.members.indexOf(id), 1)
    if (tier.members.length === 0) removeTier(segment, t)
  }
}

/** An emptied Tier disappears. A bound on it moves one Tier further out, which is still true by transitivity. */
function removeTier(segment: Segment, t: number): void {
  const tier = segment.tiers[t]
  for (const insertion of segment.queue) {
    if (insertion.above === tier) insertion.above = segment.tiers[t - 1] ?? null
    if (insertion.below === tier) insertion.below = segment.tiers[t + 1] ?? null
  }
  segment.tiers.splice(t, 1)
}

/**
 * Resolves every Undo: returns the events that still count, in log order, and whether one more Undo would act.
 * Navigation after the cancelled event goes with it: it was chosen from a state that no longer exists, and this
 * way Undo returns to the prompt the cancelled answer was given at (e.g. the last Duel of a finished Band).
 */
function resolveUndo(events: readonly LogEvent[]): { effective: RecordedEvent[]; canUndo: boolean } {
  const cancelled = new Set<number>()
  let undoable: number[] = []
  let navigation: number[] = []
  events.forEach((event, i) => {
    if (event.type === 'undo') {
      const target = undoable.pop()
      if (target === undefined) return
      cancelled.add(target)
      for (const n of navigation) if (n > target) cancelled.add(n)
      navigation = navigation.filter((n) => n < target)
      return
    }
    const role = EVENT_RULES[event.type].undoRole
    if (role === 'barrier') {
      undoable = []
      navigation = []
    } else if (role === 'navigation') navigation.push(i)
    else if (role === 'user') undoable.push(i)
  })
  const effective = events.filter(
    (event, i): event is RecordedEvent => event.type !== 'undo' && !cancelled.has(i),
  )
  return { effective, canUndo: undoable.length > 0 }
}

/** Duel answers that still count after every Undo (cancelled answers are not counted). */
export function answeredDuels(log: DuelLog): number {
  return resolveUndo(log.events).effective.filter((event) => event.type === 'duel-answered').length
}

function apply(machine: Machine, event: RecordedEvent): void {
  const rule = EVENT_RULES[event.type]
  requireEngine(machine, rule.since, rule.name)
  if (machine.newTitles && NOT_ON_NEW_TITLES.has(event.type)) {
    throw new ReplayError(`${rule.name} has no place in a Score New Titles Ranking`)
  }
  switch (event.type) {
    case 'titles-added':
      for (const id of event.ids) {
        if (machine.present.has(id)) throw new ReplayError(`Title ${id} was added twice`)
        if (machine.newTitles?.anchorIds.has(id)) throw new ReplayError(`Title ${id} is an Anchor, so it can't be a new title`)
        machine.present.add(id)
      }
      if (machine.newTitles) addNewTitles(machine.newTitles, event.ids)
      else machine.roughSortQueue.push(...event.ids)
      machine.total += event.ids.length
      return
    case 'titles-removed':
      for (const id of event.ids) {
        if (!machine.present.has(id)) throw new ReplayError(`Title ${id} was removed, but it is not in the Pool`)
        takeOut(machine, id)
        const forgotten = machine.forgotten.indexOf(id)
        if (forgotten >= 0) machine.forgotten.splice(forgotten, 1)
        machine.present.delete(id)
        // Added again later, it is a new title (ADR 0005): no last Band to bring it back to.
        machine.lastPlace.delete(id)
        machine.returning.delete(id)
        machine.total--
      }
      return
    case 'band-assigned': {
      if (machine.roughSortQueue[0] !== event.id) {
        throw new ReplayError(`Band assigned to title ${event.id}, but Rough Sort prompts ${machine.roughSortQueue[0] ?? 'nothing'}`)
      }
      leaveRoughSort(machine, event.id, placeAt(event.band, event.sub), 'fix')
      machine.placedByHand = true
      return
    }
    case 'duel-answered': {
      if (machine.newTitles) {
        const winner = event.result === 'tie' ? null : event.result === 'a' ? event.a : event.b
        if (!answerAnchorDuel(machine.newTitles, event.a, event.b, winner)) throw wrongDuel(machine, event)
        return
      }
      const work = machine.roughSortQueue.length === 0 ? current(machine) : null
      const pivot = work?.segment.tiers[work.pivot]
      const a = work?.insertion.id
      const b = pivot?.members[0]
      if (!work || !pivot || !((event.a === a && event.b === b) || (event.a === b && event.b === a))) {
        throw wrongDuel(machine, event)
      }
      const { segment, insertion } = work
      machine.focus = work.band
      machine.answeredIn = segment
      if (event.result === 'tie') {
        segment.queue.splice(segment.queue.indexOf(insertion), 1)
        pivot.members.push(insertion.id)
        return
      }
      const winner = event.result === 'a' ? event.a : event.b
      if (winner === insertion.id) insertion.below = pivot
      else insertion.above = pivot
      return
    }
    case 'forgotten':
      // Score New Titles: Forgotten on an Anchor stops using it as a reference; another Anchor is chosen (ADR 0009).
      if (machine.newTitles?.anchorIds.has(event.id) && !machine.forgotten.includes(event.id)) {
        excludeAnchor(machine.newTitles, event.id)
        machine.forgotten.push(event.id)
        return
      }
      if (!machine.present.has(event.id) || machine.forgotten.includes(event.id)) {
        throw new ReplayError(`Title ${event.id} can't be marked Forgotten: it is not in the Ranking or Rough Sort`)
      }
      takeOut(machine, event.id)
      machine.forgotten.push(event.id)
      return
    case 'band-split':
      splitBand(machine, event)
      return
    case 'band-selected':
      if (!BANDS.includes(event.band)) throw new ReplayError(`There is no Band ${String(event.band)}`)
      if (machine.roughSortQueue.length === 0 && hasWork(machine, event.band)) {
        machine.focus = event.band
        machine.finished = null
        machine.detour = null
      }
      return
    case 'band-moved':
      if (!placeOf(machine, event.id)) throw new ReplayError(`Title ${event.id} can't be moved: it is not in a Band`)
      sendToFront(machine, event.id, placeAt(event.band, event.sub))
      machine.placedAt.set(event.id, machine.step)
      machine.placedByHand = true
      return
    case 'rerank-requested': {
      const place = placeOf(machine, event.id)
      if (!place) throw new ReplayError(`Title ${event.id} can't be re-ranked: it is not in a Band`)
      sendToFront(machine, event.id, place)
      return
    }
    case 'unforgotten': {
      const index = machine.forgotten.indexOf(event.id)
      if (index < 0) throw new ReplayError(`Title ${event.id} can't be brought back: it is not Forgotten`)
      machine.forgotten.splice(index, 1)
      if (machine.newTitles?.anchorIds.has(event.id)) {
        includeAnchor(machine.newTitles, event.id)
        return
      }
      if (machine.newTitles) {
        returnNewTitle(machine.newTitles, event.id)
        return
      }
      machine.placedAt.set(event.id, machine.step)
      const last = machine.lastPlace.get(event.id)
      // Its last Sub-band only counts if the Band is still split the same way (a Band split since needs a second tap).
      if (last && placeStillFits(machine, last)) {
        sendToFront(machine, event.id, last)
        return
      }
      machine.roughSortQueue.unshift(event.id)
      machine.returning.set(event.id, machine.detour?.resume ?? { focus: machine.focus, finished: machine.finished })
      return
    }
    case 'bands-from-scores':
      bandsFromScores(machine, event)
      return
    case 'sort-goal-set':
      if (!SWITCHABLE_GOALS.includes(event.goal)) throw new ReplayError(`There is no Sort Goal ${String(event.goal)}`)
      if (event.goal === 'scores' && machine.scoring?.settings.step !== 'whole') {
        throw new ReplayError('Scores needs scoring settings on the whole Score Step first')
      }
      machine.sortGoal = event.goal
      return
    case 'scoring-set': {
      const scoring = parseSavedScoring({ format: event.format, settings: event.settings })
      if (!scoring || scoring.settings.step !== event.settings?.step) {
        throw new ReplayError(`Scoring settings ${JSON.stringify(event.settings)} don't fit Score Format ${String(event.format)}`)
      }
      if (onScores(machine) && scoring.settings.step !== 'whole') {
        throw new ReplayError('Scores always uses the whole Score Step')
      }
      machine.scoring = scoring
      return
    }
    case 'anchors-set': {
      if (machine.present.size > 0 || machine.sortGoal !== null) {
        throw new ReplayError('Anchors set must start the Ranking: before any title and any Sort Goal')
      }
      const started = startNewTitles(event.format, event.anchors, machine.seed)
      if (typeof started === 'string') throw new ReplayError(started)
      machine.newTitles = started
      machine.sortGoal = 'score-new-titles'
      return
    }
  }
}

/** A Duel answer that isn't the Duel the engine prompts now: the log is corrupt (ADR 0005). */
function wrongDuel(machine: Machine, event: Extract<LogEvent, { type: 'duel-answered' }>): ReplayError {
  const prompt = nextPrompt(machine)
  const expected = prompt.kind === 'duel' || prompt.kind === 'anchor-duel' ? `${prompt.a} vs ${prompt.b}` : prompt.kind
  return new ReplayError(`Duel answer for ${event.a} vs ${event.b}, but the engine prompts ${expected}`)
}

/**
 * `value` with `sub` only when a Sub-band is named: the field is left out rather than undefined, as events, prompts
 * and places expect (e.g. `withSub({ type: 'band-moved', id, band }, sub)`).
 */
export function withSub<const T extends object>(value: T, sub: SubBandIndex | undefined): T & { sub?: SubBandIndex } {
  return sub === undefined ? value : { ...value, sub }
}

function placeAt(band: BandIndex, sub: SubBandIndex | undefined): Place {
  return withSub({ band }, sub)
}

/** Whether a Band's Segments are three Sub-bands (ADR 0006) rather than the one whole Band. */
function isSplit(segments: readonly Segment[]): boolean {
  return segments.length > 1
}

/** The Sub-band index of Segment `s` in a Band, or undefined when the Band isn't split. */
function subOfSegment(segments: readonly Segment[], s: number): SubBandIndex | undefined {
  return isSplit(segments) ? (s as SubBandIndex) : undefined
}

/** Whether a stored place still names a Segment: a Sub-band only in a split Band, no Sub-band only in a whole one. */
function placeStillFits(machine: Machine, place: Place): boolean {
  return (place.sub !== undefined) === isSplit(machine.bands[place.band])
}

/** The Band (and Sub-band) a title is in, ranked or waiting in its insertion queue; null if it is in none. */
function placeOf(machine: Machine, id: number): Place | null {
  for (const band of BANDS) {
    const segments = machine.bands[band]
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]
      if (segment.queue.some((q) => q.id === id) || segment.tiers.some((tier) => tier.members.includes(id))) {
        return placeAt(band, subOfSegment(segments, s))
      }
    }
  }
  return null
}

/** Band moved / Re-rank / Unforgotten (ADR 0005): out of its place, to the front of `place`'s queue, placed next. */
function sendToFront(machine: Machine, id: number, place: Place): void {
  const segment = destination(machine, place.band, place.sub)
  takeOut(machine, id)
  segment.queue.unshift({ id, above: null, below: null })
  machine.lastPlace.set(id, place)
  startDetour(machine, id, place, machine.detour?.resume ?? { focus: machine.focus, finished: machine.finished })
}

function startDetour(machine: Machine, id: number, place: Place, resume: Resume): void {
  machine.detour = { id, ...place, resume }
  machine.focus = place.band
  machine.finished = null
}

/**
 * The Segment the detour title waits in, or null once it is placed (or gone). Full Ranking: it waits at the front
 * of the queue until it has its place. Scores: it is worked on until its level is settled.
 */
function detourSegment(machine: Machine): Segment | null {
  const detour = machine.detour
  if (!detour || !placeStillFits(machine, detour)) return null
  const segment = machine.bands[detour.band][detour.sub ?? 0]
  const layout = scoresLayout(machine)
  if (!layout) return segment.queue[0]?.id === detour.id ? segment : null
  const at = segment.queue.findIndex((insertion) => insertion.id === detour.id)
  return at >= 0 && !knowledge(machine, layout, segment).standing.queueSettled[at] ? segment : null
}

/** Whether a Band has Duels left: a title without a place (Full Ranking), or an unsettled title (Scores). */
function hasWork(machine: Machine, band: BandIndex): boolean {
  const layout = scoresLayout(machine)
  const segments = machine.bands[band]
  if (!layout) return segments.some((segment) => segment.queue.length > 0)
  return segments.some((segment) => knowledge(machine, layout, segment).standing.unsettled)
}

/** Under Scores (ADR 0007): where each Segment sits in the whole Ranking and how positions turn into levels. */
type ScoresLayout = {
  size: number
  offsets: Map<Segment, number>
  levelAt: (position: number) => number
  priority: (id: number) => number
}

/** Whether the log is on the Scores Sort Goal now (ADR 0007). Full Ranking skips all the Scores work. */
function onScores(machine: Machine): machine is Machine & { sortGoal: 'scores'; scoring: SavedScoring } {
  // `sort-goal-set 'scores'` is refused without scoring settings, so on Scores they are always there.
  return machine.sortGoal === 'scores' && machine.scoring !== null
}

/** The Scores layout now, or null on Full Ranking. */
function scoresLayout(machine: Machine): ScoresLayout | null {
  if (!onScores(machine)) return null
  machine.scoresCache.layout ??= layoutNow(machine)
  return machine.scoresCache.layout
}

function knowledge(machine: Machine, layout: ScoresLayout, segment: Segment): SegmentKnowledge {
  let known = machine.scoresCache.knowledge.get(segment)
  if (!known) {
    known = knowledgeOf(segment, levelContext(layout, segment))
    machine.scoresCache.knowledge.set(segment, known)
  }
  return known
}

function layoutNow(machine: Machine & { scoring: SavedScoring }): ScoresLayout {
  const offsets = new Map<Segment, number>()
  let size = 0
  for (const segment of machine.segments) {
    offsets.set(segment, size)
    size += segment.tiers.reduce((n, tier) => n + tier.members.length, 0) + segment.queue.length
  }
  const { format, settings } = machine.scoring
  const seed = machine.seed
  // Positions are whole or half (Tier averages): remembered by twice the position.
  const levels = new Map<number, number>()
  return {
    size,
    offsets,
    levelAt: (position) => {
      let level = levels.get(position * 2)
      if (level === undefined) {
        level = levelAt(format, settings, position, size)
        levels.set(position * 2, level)
      }
      return level
    },
    // Which titles are sorted first: from the seed and the id only, so replay asks the same Duels.
    priority: (id) => sideHash(seed, id, 0x5c0e5),
  }
}

function levelContext(layout: ScoresLayout, segment: Segment): LevelContext {
  return { offset: layout.offsets.get(segment) ?? 0, levelAt: layout.levelAt, priority: layout.priority }
}

/**
 * Scores: places every insertion whose interval is empty (it sits between two adjacent Tiers), in queue order.
 * Only one title of a gap becomes a Tier this way: the next one then has that Tier in its interval.
 */
function placeEmptyIntervals(segment: Segment): void {
  let indexOf = tierIndex(segment)
  for (let i = 0; i < segment.queue.length; ) {
    const insertion = segment.queue[i]
    const { lo, hi } = intervalOf(insertion, segment.tiers.length, indexOf)
    if (lo < hi) {
      i++
      continue
    }
    segment.queue.splice(i, 1)
    segment.tiers.splice(lo, 0, { members: [insertion.id] })
    indexOf = tierIndex(segment)
  }
}

/**
 * Runs after every event: Duels never start while a title waits in Rough Sort, so a pending Rough Sort drops the
 * focus; a focused Band with nothing left to place is finished, so a Band choice is due.
 */
function refocus(machine: Machine): void {
  if (machine.detour && !detourSegment(machine)) {
    machine.focus = machine.detour.resume.focus
    machine.finished = machine.detour.resume.finished
    machine.detour = null
  }
  if (machine.roughSortQueue.length > 0) {
    machine.focus = null
    machine.finished = null
    machine.detour = null
  } else if (machine.focus !== null && !hasWork(machine, machine.focus)) {
    machine.finished = machine.focus
    machine.focus = null
  }
}

function requireEngine(machine: Machine, version: number, what: string): void {
  if (machine.engine < version) throw new ReplayError(`${what} needs engine version ${version}, but the log says ${machine.engine}`)
}

/** The Segment a title goes to in a Band: the Band itself, or the chosen Sub-band of a split Band. */
function destination(machine: Machine, band: BandIndex, sub: SubBandIndex | undefined): Segment {
  const segments = machine.bands[band]
  if (sub !== undefined) requireEngine(machine, 2, 'A Sub-band target')
  if (!isSplit(segments)) {
    if (sub !== undefined) throw new ReplayError(`Band ${band} is not split, so it has no Sub-band ${sub}`)
    return segments[0]
  }
  const segment = sub === undefined ? undefined : segments[sub]
  if (!segment) throw new ReplayError(`Band ${band} is split: a Sub-band must be chosen`)
  return segment
}

/**
 * Splits one Band into Best / Middle / Lowest (ADR 0006). Ranked titles are cut by their existing order; each
 * unplaced title goes where the event says, keeping its old queue order. An insertion in progress keeps the
 * bounds that fall inside its new Sub-band and drops the rest (that edge becomes the Sub-band's edge).
 */
function splitBand(machine: Machine, event: Extract<LogEvent, { type: 'band-split' }>): void {
  const segments = machine.bands[event.band]
  if (isSplit(segments)) throw new ReplayError(`Band ${event.band} is already split`)
  const [whole] = segments
  const [c1, c2] = event.cuts
  const isCut = (c: number) => Number.isInteger(c) && c >= 0 && c <= whole.tiers.length
  if (!isCut(c1) || !isCut(c2) || c1 > c2) {
    throw new ReplayError(`Band split cut points ${c1}, ${c2} don't fit a Band of ${whole.tiers.length} Tiers`)
  }
  const subOf = new Map<number, SubBandIndex>()
  for (const sub of SUB_BANDS) for (const id of event.unplaced[sub]) subOf.set(id, sub)
  const listed = event.unplaced.reduce((sum, ids) => sum + ids.length, 0)
  if (listed !== whole.queue.length || subOf.size !== listed || whole.queue.some((q) => !subOf.has(q.id))) {
    throw new ReplayError(`Band split must list exactly the titles without a place in Band ${event.band}`)
  }
  const parts: Segment[] = [
    { tiers: whole.tiers.slice(0, c1), queue: [] },
    { tiers: whole.tiers.slice(c1, c2), queue: [] },
    { tiers: whole.tiers.slice(c2), queue: [] },
  ]
  for (const insertion of whole.queue) {
    const part = parts[subOf.get(insertion.id) ?? 1]
    const keep = (bound: Tier | null) => (bound && part.tiers.includes(bound) ? bound : null)
    part.queue.push({ id: insertion.id, above: keep(insertion.above), below: keep(insertion.below) })
  }
  machine.bands[event.band] = parts
  machine.segments = machine.bands.flat()
  parts.forEach((part, sub) => {
    const place = placeAt(event.band, sub as SubBandIndex)
    for (const tier of part.tiers) for (const id of tier.members) machine.lastPlace.set(id, place)
    for (const insertion of part.queue) machine.lastPlace.set(insertion.id, place)
  })
}

/**
 * Rough Sort from Scores (ADR 0008): every listed title leaves the Rough Sort queue for the back of its Band's
 * queue. Only valid while no title has had its Band chosen by hand (ADR 0008): it is offered when a Ranking starts.
 */
function bandsFromScores(machine: Machine, event: Extract<LogEvent, { type: 'bands-from-scores' }>): void {
  if (machine.placedByHand) {
    throw new ReplayError('Bands from scores must come before any Band is chosen by hand')
  }
  if (!Array.isArray(event.bands) || event.bands.length !== BANDS.length) {
    throw new ReplayError('Bands from scores must list titles for each of the five Bands')
  }
  const listed = new Set<number>()
  for (const band of BANDS) {
    for (const id of event.bands[band]) {
      if (listed.has(id) || !machine.roughSortQueue.includes(id)) {
        throw new ReplayError(`Bands from scores lists title ${id}, but it is not waiting in Rough Sort`)
      }
      listed.add(id)
      leaveRoughSort(machine, id, placeAt(band, undefined), 'in-order')
    }
  }
}

/**
 * A title leaves Rough Sort for the insertion queue of its (Sub-)band, normally at the back.
 *
 * A title brought back through Rough Sort (Unforgotten with no usable last Sub-band, in `returning`) differs by
 * who placed it. Tapped by hand (`'fix'`), it is a fix like any other: it goes to the front and is placed next,
 * then Duels resume where they were. Placed by Rough Sort from Scores (`'in-order'`), it is just one of the titles
 * the event lists, and goes to the back in the event's order like the rest; nothing is resumed.
 */
function leaveRoughSort(machine: Machine, id: number, place: Place, returning: 'fix' | 'in-order'): void {
  const segment = destination(machine, place.band, place.sub)
  takeOut(machine, id)
  machine.lastPlace.set(id, place)
  machine.placedAt.set(id, machine.step)
  const resume = machine.returning.get(id)
  machine.returning.delete(id)
  if (!resume || returning === 'in-order') {
    segment.queue.push({ id, above: null, below: null })
    return
  }
  segment.queue.unshift({ id, above: null, below: null })
  if (machine.roughSortQueue.length === 0) startDetour(machine, id, place, resume)
}

/** The insertion being worked on, where it is, and the Tier it is compared with now (see `current`). */
type Work = {
  band: BandIndex
  sub: SubBandIndex | undefined
  segment: Segment
  insertion: Insertion
  /** The pivot, as a Tier index inside its Segment. */
  pivot: number
  /** Full Ranking only: where the insertion may still land, as Tier indexes inside its Segment. */
  interval: { lo: number; hi: number } | null
  /** How many of the Band's Tiers come before the Segment. */
  offset: number
}

/**
 * The insertion Duels work on now: in the focused Band if there is one, else Band by Band from the top; inside a
 * split Band Best → Middle → Lowest (so a chosen split Band starts at its first Sub-band with titles to place).
 * Full Ranking inserts the front title by binary insertion; Scores asks the level-targeted Duel (ADR 0007).
 */
function current(machine: Machine): Work | null {
  const detour = detourSegment(machine)
  const bands = machine.detour && detour ? [machine.detour.band] : machine.focus === null ? BANDS : [machine.focus]
  const layout = scoresLayout(machine)
  for (const band of bands) {
    const segments = machine.bands[band]
    let offset = 0
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]
      if (!detour || segment === detour) {
        if (layout) {
          const duel = nextLevelDuel(knowledge(machine, layout, segment), detour ? machine.detour?.id : undefined)
          if (duel) {
            const insertion = segment.queue[duel.insertion]
            return { band, sub: subOfSegment(segments, s), segment, insertion, pivot: duel.tier, interval: null, offset }
          }
        } else if (segment.queue[0]) {
          const interval = insertionInterval(segment, segment.queue[0])
          const pivot = Math.floor((interval.lo + interval.hi) / 2)
          return { band, sub: subOfSegment(segments, s), segment, insertion: segment.queue[0], pivot, interval, offset }
        }
      }
      offset += segment.tiers.length
    }
  }
  return null
}

/** The next prompt: Rough Sort first, then Duels Band by Band from the top. */
function nextPrompt(machine: Machine): Prompt {
  const roughSort = machine.roughSortQueue[0]
  if (roughSort !== undefined) return { kind: 'rough-sort', id: roughSort }
  if (machine.newTitles) {
    const duel = nextAnchorDuel(machine.newTitles)
    if (!duel) return { kind: 'all-complete' }
    const [left, right] = sides(machine.seed, duel.a, duel.b)
    return { kind: 'anchor-duel', a: duel.a, b: duel.b, left, right }
  }
  const work = current(machine)
  if (!work) return { kind: 'all-complete' }
  const { band, sub, segment, insertion, pivot, interval, offset } = work
  const b = segment.tiers[pivot].members[0]
  const [left, right] = sides(machine.seed, insertion.id, b)
  const duel = { kind: 'duel' as const, band, a: insertion.id, b, left, right }
  if (!interval) return withSub(machine.settledOnce ? { ...duel, refine: true as const } : duel, sub)
  return withSub({ ...duel, bounds: { lo: interval.lo + offset, hi: interval.hi + offset, pivot: pivot + offset } }, sub)
}

/** Which card is on the left (ADR 0005): `hash(seed, min, max)`, display only. */
function sides(seed: number, a: number, b: number): [number, number] {
  const low = Math.min(a, b)
  const high = Math.max(a, b)
  return sideHash(seed, low, high) & 1 ? [high, low] : [low, high]
}

/** Under Scores: every title's possible positions, and which are settled. */
function standingNow(machine: Machine, layout: ScoresLayout): Standing {
  const titles = new Map<number, PositionRange & { band: BandIndex }>()
  const settled = new Set<number>()
  machine.bands.forEach((segments, band) => {
    for (const segment of segments) {
      const { standing } = knowledge(machine, layout, segment)
      segment.tiers.forEach((tier, t) => {
        for (const id of tier.members) {
          titles.set(id, { band: band as BandIndex, ...standing.tiers[t] })
          if (standing.tierSettled[t]) settled.add(id)
        }
      })
      segment.queue.forEach((insertion, u) => {
        titles.set(insertion.id, { band: band as BandIndex, ...standing.queue[u] })
        if (standing.queueSettled[u]) settled.add(insertion.id)
      })
    }
  })
  return { size: layout.size, titles, settled }
}

/** Rebuilds the derived state from the log. Throws ReplayError if the log can't be trusted. */
export function replay(log: DuelLog): RankingState {
  const { format, engine, seed } = log.header
  if (format !== LOG_FORMAT_VERSION) throw new ReplayError(`Unknown log format version ${format}`)
  if (!KNOWN_ENGINE_VERSIONS.includes(engine)) throw new ReplayError(`Unknown engine version ${engine}`)
  const bandSegments: Segment[][] = BANDS.map(() => [{ tiers: [], queue: [] }])
  const machine: Machine = {
    engine,
    roughSortQueue: [],
    bands: bandSegments,
    segments: bandSegments.flat(),
    forgotten: [],
    present: new Set(),
    total: 0,
    focus: null,
    finished: null,
    lastPlace: new Map(),
    detour: null,
    returning: new Map(),
    step: 0,
    placedAt: new Map(),
    placedByHand: false,
    sortGoal: null,
    scoring: null,
    seed,
    scoresCache: { knowledge: new Map() },
    answeredIn: null,
    settledOnce: false,
    newTitles: null,
  }
  const { effective, canUndo } = resolveUndo(log.events)
  for (let step = 0; step < effective.length; step++) {
    machine.step = step
    const event = effective[step]
    machine.answeredIn = null
    apply(machine, event)
    const answeredIn = machine.answeredIn
    if (!onScores(machine)) machine.segments.forEach(placeEmptyFronts)
    else if (answeredIn) {
      placeEmptyIntervals(answeredIn)
      // A Duel answer changes only its own Segment: no title joins or leaves, so the layout still holds.
      machine.scoresCache.knowledge.delete(answeredIn)
    } else {
      machine.segments.forEach(placeEmptyIntervals)
      machine.scoresCache = { knowledge: new Map() }
    }
    refocus(machine)
    // A focused Band always has work, so only a Ranking with no focus can be all settled. An empty one doesn't count.
    if (!machine.settledOnce && onScores(machine) && machine.roughSortQueue.length === 0 && machine.focus === null) {
      machine.settledOnce = scoresLayout(machine)!.size > 0 && BANDS.every((band) => !hasWork(machine, band))
    }
  }
  const layout = scoresLayout(machine)
  const standing = layout ? standingNow(machine, layout) : null
  const bands = machine.bands.map((segments): BandState => {
    const parts = segments.map((segment) => ({
      tiers: segment.tiers.map((tier) => [...tier.members]),
      unplaced: segment.queue.map((insertion) => insertion.id),
    }))
    const whole = { tiers: parts.flatMap((p) => p.tiers), unplaced: parts.flatMap((p) => p.unplaced) }
    return isSplit(segments) ? { ...whole, subBands: [parts[0], parts[1], parts[2]] } : whole
  })
  const work = machine.roughSortQueue.length === 0 && machine.focus === null ? current(machine) : null
  const bandChoice = work ? { finished: machine.finished, next: work.band } : null
  const bandProgress = bands.map((band) => progressOf(standing ? { standing } : {}, band))
  const newTitles = machine.newTitles && newTitlesView(machine.newTitles)
  // Under Score New Titles: settled new titles out of every new title (there are no Bands).
  const ranked = newTitles
    ? { done: newTitles.titles.filter((t) => t.settled).length, total: newTitles.titles.length }
    : {
        done: bandProgress.reduce((sum, p) => sum + p.done, 0),
        total: bandProgress.reduce((sum, p) => sum + p.total, 0),
      }
  return {
    prompt: nextPrompt(machine),
    bands,
    forgotten: machine.forgotten,
    progress: {
      roughSort: { done: machine.total - machine.roughSortQueue.length, total: machine.total },
      bands: bandProgress,
      ranked,
    },
    bandChoice,
    canUndo,
    // No Board under Score New Titles: it has no Bands (ADR 0009).
    board: new LazyBoard(!newTitles && !effective.some((event) => event.type === 'duel-answered'), machine.bands, machine.placedAt),
    ...(machine.sortGoal && { sortGoal: machine.sortGoal }),
    ...(machine.scoring && { scoring: machine.scoring }),
    ...(standing && { standing }),
    ...(newTitles && { newTitles }),
  }
}

/**
 * The Board, with its Bands built on first read only: replay runs after every Duel answer, and most callers never
 * look at the Board. A class rather than a closure in `replay`, so replay itself stays as cheap as before the Board.
 */
class LazyBoard implements BoardView {
  readonly open: boolean
  #segments: readonly (readonly Segment[])[]
  #placedAt: ReadonlyMap<number, number>
  #bands: BoardView['bands'] | undefined

  constructor(open: boolean, segments: readonly (readonly Segment[])[], placedAt: ReadonlyMap<number, number>) {
    this.open = open
    this.#segments = segments
    this.#placedAt = placedAt
  }

  get bands(): BoardView['bands'] {
    this.#bands ??= this.#segments.map((segments) => ({ titles: boardTitles(segments, this.#placedAt) }))
    return this.#bands
  }
}

/** A Band's titles in Board order: latest `at` first, then by id. */
function boardTitles(segments: readonly Segment[], placedAt: ReadonlyMap<number, number>): BoardTitle[] {
  const titles = segments.flatMap((segment, s) => {
    const ids = [...segment.tiers.flatMap((tier) => tier.members), ...segment.queue.map((insertion) => insertion.id)]
    return ids.map((id) => withSub({ id, at: placedAt.get(id) ?? 0 }, subOfSegment(segments, s)))
  })
  return titles.sort((x, y) => y.at - x.at || x.id - y.id)
}
