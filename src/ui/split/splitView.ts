// The Split screen's view (issue #4, ADR 0006): the offer to split an oversized Band, the three columns its titles are
// sorted into with what that saves, the `band-split` event Done records, and the Band once it is split. Pure;
// SplitScreen keeps the choices and renders.
//
// Three steps: `offer` → `columns` (once the offer is taken) → `done` (once the Ranking has the Band split).
import {
  BANDS,
  SUB_BANDS,
  progressOf,
  titlesIn,
  type BandIndex,
  type BandState,
  type LogEvent,
  type RankingState,
  type SubBandIndex,
} from '../../ranking/engine.ts'
import {
  LOW_SAVINGS,
  defaultCuts,
  offerSavings,
  quarterSplit,
  splitSavings,
  unplacedToSort,
  worstCaseDuels,
  type SegmentSize,
} from '../../ranking/split.ts'

/** The one event a split is recorded as (ADR 0006). */
export type BandSplitEvent = Extract<LogEvent, { type: 'band-split' }>

/** What the user has done on the Split screen so far. Kept by SplitScreen, in memory only; starts as `startingChoices`. */
export type SplitChoices = {
  /** The offer was taken: the three columns show. */
  sorting: boolean
  /** Where the two dividers of the "Already ranked" strip sit, as Tier edges (0 = before the first Tier). */
  cuts: [number, number]
  /** The Sub-band of each title without a place; one that isn't listed is in Middle. */
  subBandOf: ReadonlyMap<number, SubBandIndex>
  /** The Sub-band of the Band's single ranked title, when the columns show it as a cover (`SplitCard.ranked`). */
  rankedSubBand: SubBandIndex
  /** The "Middle still has N titles" warning is up. */
  warning: boolean
}

export type SplitInput = {
  state: RankingState
  /** The Band the screen is about. */
  band: BandIndex
  choices: SplitChoices
}

/** One bar of the chart: a Band, or one Sub-band of the Band just split. */
export type SplitBar = {
  band: BandIndex
  /** Null for a whole Band. */
  subBand: SubBandIndex | null
  /** Titles in it, with or without a place. */
  count: number
  /** The Band the offer is about. */
  oversized: boolean
}

/** One cover in a column. */
export type SplitCard = {
  id: number
  /** The Band's single ranked title: it keeps its place, and the column it is in decides the cut points. */
  ranked: boolean
}

/** The "Already ranked" strip: the Band's Tiers in their order, each in the Sub-band the dividers leave it in. */
export type SplitStrip = {
  tiers: { titles: readonly number[]; subBand: SubBandIndex }[]
  /** The Tier edges the Best / Middle and the Middle / Lowest dividers sit on. */
  cuts: [number, number]
}

/**
 * What pressing Done does: record `event`, or, when the split saves fewer than `LOW_SAVINGS` Duels, ask first by
 * putting the warning up (`askFirst`).
 */
export type SplitDone = { ask: false; event: BandSplitEvent } | { ask: true }

export type SplitView =
  | {
      step: 'offer'
      bars: SplitBar[]
      /** Worst-case Duels left over every Band now, and once this Band is split ¼ / ½ / ¼. */
      duelsNow: number
      duelsAfter: number
      /** "up to −N Duels": the difference. */
      savings: number
    }
  | {
      step: 'columns'
      /**
       * Best, Middle, Lowest: the single ranked title first when the columns show it, then the titles without a place
       * in the order they will be inserted. Settled titles (Scores) are among them, since the split places every
       * title without a place, but the estimates skip them.
       */
      columns: [SplitCard[], SplitCard[], SplitCard[]]
      /** Null for a Band with at most one ranked title: that one shows as a cover in the columns instead. */
      strip: SplitStrip | null
      /** "up to −N Duels" for the columns as they are, and whether that is under `LOW_SAVINGS`. */
      savings: number
      lowSavings: boolean
      /** Worst-case Duels left in the Band while it stays one Band. */
      duelsAsOneBand: number
      done: SplitDone
      /**
       * Null unless the warning is up. Then how many titles Middle holds, what a quarter each way would save instead
       * of `savings`, and the event "Finish anyway" records.
       */
      warning: { middle: number; quarterSavings: number; event: BandSplitEvent } | null
    }
  | {
      step: 'done'
      /** The split Band as three bars, one per Sub-band. */
      bars: SplitBar[]
      /** Worst-case Duels left in the Band, Sub-band by Sub-band. */
      duelsLeft: number
      /** The first Sub-band with titles to place, where choosing the Band starts; null when it has none. */
      firstSubBand: SubBandIndex | null
    }

/** Cut points that put a Band's single Tier into the given Sub-band. */
const LONE_TIER_CUTS: Record<SubBandIndex, [number, number]> = { 0: [1, 1], 1: [0, 1], 2: [0, 0] }

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

/** Worst-case Duels left in a Band, Sub-band by Sub-band once it is split; settled titles on Scores need none. */
function bandWorstCase(state: RankingState, band: BandState): number {
  const parts = band.subBands ?? [band]
  return worstCaseDuels(parts.map((p) => ({ places: p.tiers.length, unplaced: unplacedToSort(state, p).length })))
}

/**
 * Whether the Band's ranked titles need the "Already ranked" strip with dividers. A Band fresh from Rough Sort
 * has one placed title (the first needs no Duel); that single Tier is shown as a cover in the columns instead,
 * and the column it ends up in decides the cut points.
 */
const needsStrip = (band: BandState) => band.tiers.length > 1 || (band.tiers[0]?.length ?? 0) > 1

/** The single Tier the columns show as a cover; null when the strip shows the ranked titles, or there are none. */
const loneTier = (band: BandState) => (!needsStrip(band) && band.tiers.length === 1 ? band.tiers[0] : null)

/** The cut points the choices give the Band: the dividers', or those of the column the single Tier is in. */
function cutsOf(band: BandState, choices: SplitChoices): [number, number] {
  if (needsStrip(band)) return choices.cuts
  return loneTier(band) ? LONE_TIER_CUTS[choices.rankedSubBand] : [0, 0]
}

/** The chart: a bar per Band, the Band just split as a bar per Sub-band. */
function barsOf(state: RankingState, split: BandIndex | null, oversized: BandIndex | null): SplitBar[] {
  return BANDS.flatMap((band): SplitBar[] => {
    const subBands = band === split ? state.bands[band].subBands : undefined
    if (subBands) return SUB_BANDS.map((subBand) => ({ band, subBand, count: titlesIn(subBands[subBand]), oversized: false }))
    return [{ band, subBand: null, count: state.progress.bands[band].total, oversized: band === oversized }]
  })
}

/** What the Split screen opens with: the offer, everything without a place in Middle, a single ranked Tier too. */
export function startingChoices(state: RankingState, band: BandIndex): SplitChoices {
  const b = state.bands[band]
  return {
    sorting: false,
    cuts: defaultCuts(b.tiers.map((tier) => tier.length)),
    subBandOf: new Map(b.unplaced.map((id) => [id, 1])),
    rankedSubBand: 1,
    warning: false,
  }
}

/** The choices after "Split": the three columns show. */
export function takeOffer(choices: SplitChoices): SplitChoices {
  return { ...choices, sorting: true }
}

/**
 * The choices after a cover is dropped on a column or moved by its ↑ ↓ buttons. A title that isn't one of the Band's
 * covers (anything else dragged onto a column) changes nothing.
 */
export function moveTitle(input: SplitInput, id: number, subBand: SubBandIndex): SplitChoices {
  const { state, band, choices } = input
  const b = state.bands[band]
  if (loneTier(b)?.includes(id)) return { ...choices, rankedSubBand: subBand }
  if (!b.unplaced.includes(id)) return choices
  return { ...choices, subBandOf: new Map(choices.subBandOf).set(id, subBand) }
}

/**
 * The choices after a divider of the strip (0 = Best / Middle, 1 = Middle / Lowest) is put on a Tier edge. An edge
 * past either end stops at that end, and a divider that would cross the other takes it along.
 */
export function moveDivider(input: SplitInput, divider: 0 | 1, edge: number): SplitChoices {
  const { state, band, choices } = input
  const e = Math.max(0, Math.min(state.bands[band].tiers.length, edge))
  const cuts: [number, number] = divider === 0 ? [e, Math.max(e, choices.cuts[1])] : [Math.min(choices.cuts[0], e), e]
  return { ...choices, cuts }
}

/** The choices after Done on a split that saves too little: the warning is up. */
export function askFirst(choices: SplitChoices): SplitChoices {
  return { ...choices, warning: true }
}

/** The choices after "Keep sorting": the warning is down. */
export function keepSorting(choices: SplitChoices): SplitChoices {
  return { ...choices, warning: false }
}

export function splitView(input: SplitInput): SplitView {
  const { state, band, choices } = input
  const b = state.bands[band]

  if (b.subBands) {
    const subBands = b.subBands
    const firstSubBand =
      SUB_BANDS.find((sub) => {
        const { done, total } = progressOf(state, subBands[sub])
        return done < total
      }) ?? null
    return { step: 'done', bars: barsOf(state, band, null), duelsLeft: bandWorstCase(state, b), firstSubBand }
  }

  if (!choices.sorting) {
    const duelsNow = sum(state.bands.map((each) => bandWorstCase(state, each)))
    const savings = offerSavings(state, b)
    return { step: 'offer', bars: barsOf(state, null, band), duelsNow, duelsAfter: duelsNow - savings, savings }
  }

  const strip = needsStrip(b)
  const lone = loneTier(b)
  const cuts = cutsOf(b, choices)
  const unplaced = SUB_BANDS.map((sub) => b.unplaced.filter((id) => (choices.subBandOf.get(id) ?? 1) === sub))
  const toSort = new Set(unplacedToSort(state, b))
  const places = [cuts[0], cuts[1] - cuts[0], b.tiers.length - cuts[1]]
  const whole: SegmentSize = { places: b.tiers.length, unplaced: toSort.size }
  const parts = (sizes: readonly number[]) =>
    SUB_BANDS.map((sub) => ({ places: places[sub], unplaced: sizes[sub] })) as [SegmentSize, SegmentSize, SegmentSize]
  const savings = splitSavings(whole, parts(unplaced.map((ids) => ids.filter((id) => toSort.has(id)).length)))
  const lowSavings = savings < LOW_SAVINGS
  const column = (sub: SubBandIndex): SplitCard[] => [
    ...(lone && choices.rankedSubBand === sub ? lone.map((id) => ({ id, ranked: true })) : []),
    ...unplaced[sub].map((id) => ({ id, ranked: false })),
  ]
  const columns: [SplitCard[], SplitCard[], SplitCard[]] = [column(0), column(1), column(2)]
  const event: BandSplitEvent = { type: 'band-split', band, cuts, unplaced: [unplaced[0], unplaced[1], unplaced[2]] }
  const subBandOfTier = (t: number): SubBandIndex => (t < cuts[0] ? 0 : t < cuts[1] ? 1 : 2)
  return {
    step: 'columns',
    columns,
    strip: strip ? { tiers: b.tiers.map((titles, t) => ({ titles, subBand: subBandOfTier(t) })), cuts } : null,
    savings,
    lowSavings,
    duelsAsOneBand: bandWorstCase(state, b),
    done: lowSavings ? { ask: true } : { ask: false, event },
    warning: choices.warning
      ? { middle: columns[1].length, quarterSavings: splitSavings(whole, parts(quarterSplit(toSort.size))), event }
      : null,
  }
}
