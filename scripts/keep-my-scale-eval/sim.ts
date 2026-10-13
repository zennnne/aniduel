// Simulated-user eval for Keep My Scale (ADR 0009, ADR 0012, ADR 0013): made-up Anchor lists and users answer every Duel, and
// the table says how many Duels a title took, where it ended against its true worth, and which Anchors turned
// Suspect. Kept out of the test suite; it drives the placement module itself, so a change to a rule shows up here.
//
// The model, where the oracle in src/ranking/keepMyScale.test.ts is exact: an Anchor's true worth is its score give or
// take SPREAD (two Anchors on one score are not equally good), a few Anchors drifted, and a user may never answer
// "about the same".
import {
  addPickedTitles,
  answerAnchorDuel,
  answerCloserTo,
  keepMyScaleView,
  nextQuestion,
  startKeepMyScale,
  type AnchorScore,
  type SplitRule,
} from '../../src/ranking/keepMyScale.ts'

/** How far an Anchor's true worth may sit from its score, either way. */
const SPREAD = 0.5

/** Share of Anchors whose score drifted, and by how many points (up or down). */
const DRIFT_SHARE = 0.05
const DRIFT_BY = 2

/** Roughly how an AniList user's scores are spread over POINT_10. */
const SHARES: ReadonlyArray<readonly [level: number, share: number]> = [
  [10, 0.05],
  [9, 0.12],
  [8, 0.25],
  [7, 0.28],
  [6, 0.17],
  [5, 0.08],
  [4, 0.05],
]

/**
 * A list of Anchor scores to place titles against, and how many titles are picked. With `halves` the list is on 10
 * points with decimals and every score also moves to a half point near it, as a user scoring in 0.5 steps has them.
 */
export type Case = { name: string; scores: (random: () => number) => number[]; titles: number; halves?: boolean }

/** How a user answers: "about the same" within `tieWithin` points, and `noise` (a standard deviation) on each Duel. */
export type User = { name: string; tieWithin: number; noise: number }

const typical = (n: number) => (random: () => number) =>
  Array.from({ length: n }, () => {
    let x = random()
    for (const [level, share] of SHARES) if ((x -= share) < 0) return level
    return SHARES[SHARES.length - 1][0]
  })

const counted =
  (...counts: (readonly [level: number, n: number])[]) =>
  () =>
    counts.flatMap(([level, n]) => Array.from({ length: n }, () => level))

export const CASES: readonly Case[] = [
  { name: '100 Anchors, 20 titles', scores: typical(100), titles: 20 },
  { name: '100 Anchors, 100 titles', scores: typical(100), titles: 100 },
  { name: '100 Anchors, 300 titles', scores: typical(100), titles: 300 },
  { name: '30 Anchors, 100 titles', scores: typical(30), titles: 100 },
  // A score with exactly two Anchors beside crowded ones, at the top of the scale.
  { name: 'two 10s among 172 Anchors, 20 titles', scores: counted([10, 2], [9, 40], [8, 60], [7, 50], [6, 20]), titles: 20 },
  { name: '700 Anchors on half points, 20 titles', scores: typical(700), titles: 20, halves: true },
  { name: '700 Anchors on half points, 100 titles', scores: typical(700), titles: 100, halves: true },
]

/** Lists from few Anchors a score to many, to see from where Deciding Duels (ADR 0013) are worth their Duels. */
export const SWEEP: readonly Case[] = [20, 40, 70, 100, 150, 200, 300, 400, 700].flatMap((n) => [
  { name: `${n} Anchors, 20 titles`, scores: typical(n), titles: 20 },
  { name: `${n} Anchors on half points, 20 titles`, scores: typical(n), titles: 20, halves: true },
])

export const USERS: readonly User[] = [
  { name: 'never ties, steady', tieWithin: 0, noise: 0 },
  { name: 'never ties, noisy', tieWithin: 0, noise: 0.3 },
  { name: 'ties within 0.25, noisy', tieWithin: 0.25, noise: 0.3 },
]

/** Small seeded PRNG (mulberry32), so every run is reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const gauss = (random: () => number) => Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random())

/** What the runs of one case and user add up to. */
export type Tally = {
  titles: number
  duels: number
  /** The most Duels any one title took. */
  mostDuels: number
  closerTo: number
  /** Titles that ended on the score (of the case's grid) nearest their true worth. */
  nearest: number
  /** How far the settled titles ended from their true worth, added up. */
  error: number
  /** Anchors and Anchor scores of every run, added up. */
  anchors: number
  levels: number
  /** Titles that ended a whole point or more from their true worth. */
  off: number
  /** Titles whose nearest score is the top or bottom Anchor score, and how many of them ended past it. */
  endTitles: number
  pastEnd: number
  /** Titles that had no question left and were later asked one again. */
  reasked: number
  unsettled: number
  honest: number
  honestSuspect: number
  drifted: number
  driftedSuspect: number
}

const emptyTally = (): Tally => ({
  titles: 0,
  duels: 0,
  mostDuels: 0,
  closerTo: 0,
  nearest: 0,
  error: 0,
  anchors: 0,
  levels: 0,
  off: 0,
  endTitles: 0,
  pastEnd: 0,
  reasked: 0,
  unsettled: 0,
  honest: 0,
  honestSuspect: 0,
  drifted: 0,
  driftedSuspect: 0,
})

/** One Ranking of `kase` answered by `user`, added to `tally`. */
function runOnce(kase: Case, user: User, split: SplitRule, seed: number, tally: Tally): void {
  const random = rng(seed)
  const half = (level: number) => Math.min(10, Math.max(1, Math.round(2 * (level + random() - 0.5)) / 2))
  const anchors: AnchorScore[] = kase.scores(random).map((level, i) => ({ id: 1000 + i, level: kase.halves ? half(level) : level }))
  const worth = new Map<number, number>()
  const drifted = new Set<number>()
  for (const { id, level } of anchors) {
    let value = level + (2 * random() - 1) * SPREAD
    if (random() < DRIFT_SHARE) {
      value += random() < 0.5 ? DRIFT_BY : -DRIFT_BY
      drifted.add(id)
    }
    worth.set(id, value)
  }
  // Picked titles are spread like the list itself: around the score of an Anchor drawn at random.
  const ids = Array.from({ length: kase.titles }, (_, i) => 1 + i)
  const truth = new Map(ids.map((id) => [id, anchors[Math.floor(random() * anchors.length)].level + random() - 0.5]))

  const state = startKeepMyScale(kase.halves ? 'POINT_10_DECIMAL' : 'POINT_10', anchors, seed, split)
  if (typeof state === 'string') throw new Error(state)
  addPickedTitles(state, ids)

  const asked = new Map<number, number>()
  const done = new Set<number>()
  const reasked = new Set<number>()
  let current: number | null = null
  for (let question = nextQuestion(state), steps = 0; question; question = nextQuestion(state)) {
    if (++steps > 1_000_000) throw new Error('runaway')
    const id = question.kind === 'closer-to' ? question.id : question.a
    // Questions go down the queue in order: once they move on from a title, it had none left.
    if (current !== null && current !== id) done.add(current)
    if (done.has(id)) reasked.add(id)
    current = id
    const mine = truth.get(id)!
    if (question.kind === 'closer-to') {
      tally.closerTo++
      const level = Math.abs(mine - question.upper) <= Math.abs(mine - question.lower) ? question.upper : question.lower
      if (!answerCloserTo(state, id, level)) throw new Error('closer-to answer refused')
      continue
    }
    const felt = mine - worth.get(question.b)! + user.noise * gauss(random)
    const winner = Math.abs(felt) <= user.tieWithin ? null : felt > 0 ? question.a : question.b
    if (!answerAnchorDuel(state, question.a, question.b, winner)) throw new Error('Duel answer refused')
    asked.set(id, (asked.get(id) ?? 0) + 1)
  }

  const view = keepMyScaleView(state)
  const top = view.levels[0].level
  const bottom = view.levels[view.levels.length - 1].level
  tally.titles += ids.length
  tally.anchors += anchors.length
  tally.levels += view.levels.length
  tally.reasked += reasked.size
  for (const n of asked.values()) {
    tally.duels += n
    tally.mostDuels = Math.max(tally.mostDuels, n)
  }
  for (const title of view.titles) {
    if (!title.settled) {
      tally.unsettled++
      continue
    }
    const mine = truth.get(title.id)!
    const score = title.levels[0]
    const nearest = kase.halves ? Math.round(2 * mine) / 2 : Math.round(mine)
    tally.error += Math.abs(score - mine)
    if (score === nearest) tally.nearest++
    if (Math.abs(score - mine) >= 1) tally.off++
    if (nearest === top || nearest === bottom) {
      tally.endTitles++
      if (score > top || score < bottom) tally.pastEnd++
    }
  }
  const suspect = new Set(view.suspect.map((s) => s.id))
  for (const { id } of anchors) {
    if (drifted.has(id)) {
      tally.drifted++
      if (suspect.has(id)) tally.driftedSuspect++
    } else {
      tally.honest++
      if (suspect.has(id)) tally.honestSuspect++
    }
  }
}

const share = (part: number, whole: number) => (whole === 0 ? '-' : `${((100 * part) / whole).toFixed(1)}%`)

/** Runs every case against every user over `seeds` Rankings each, and returns the Markdown table. */
export function runEval(seeds: number, split: SplitRule, log: (line: string) => void, cases: readonly Case[] = CASES): string {
  const rows = [
    '| Anchors and titles | Anchors per score | User | Duels per title | Most Duels, one title | Closer-to asked | On the nearest score | Points off, on average | A point or more off | End titles past the end | Asked again after settling | Left unsettled | Honest Anchors Suspect | Drifted Anchors Suspect |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const kase of cases) {
    for (const user of USERS) {
      log(`${kase.name}: ${user.name}`)
      const tally = emptyTally()
      for (let seed = 1; seed <= seeds; seed++) runOnce(kase, user, split, seed, tally)
      rows.push(
        `| ${[
          kase.name,
          (tally.anchors / tally.levels).toFixed(0),
          user.name,
          (tally.duels / tally.titles).toFixed(2),
          tally.mostDuels,
          share(tally.closerTo, tally.titles),
          share(tally.nearest, tally.titles),
          (tally.error / (tally.titles - tally.unsettled)).toFixed(2),
          share(tally.off, tally.titles),
          share(tally.pastEnd, tally.endTitles),
          share(tally.reasked, tally.titles),
          share(tally.unsettled, tally.titles),
          share(tally.honestSuspect, tally.honest),
          share(tally.driftedSuspect, tally.drifted),
        ].join(' | ')} |`,
      )
    }
  }
  return rows.join('\n')
}
