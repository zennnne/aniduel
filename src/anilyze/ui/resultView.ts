// What an AniLyze tool's result shows (#92, layout picked in #89): every ranked studio or Director as a card (rank,
// hearts, picture), and an opened one's counted titles with how each pushed its score. Pure: the result components
// render it.
import { scoreWorth, utility, type Label, type Ranking, type Vote, type WhoScore } from '../scoring.ts'
import { isDropped, rewatchesOf } from '../types.ts'

export type RankCard = {
  id: number
  name: string
  /** 1 for the user's top one; null on the 🌱 watchlist. */
  rank: number | null
  label: Label
  /** The raw Studio Score or Director Score S, shown only in a tooltip. */
  score: number
  /** S as 0–5 hearts, relative to the user's #1. */
  hearts: number
  /** How many Votes it has: its counted titles, which the gate reads. */
  votes: number
  hitRate: number
  flopRate: number
  /**
   * Its picture: for a studio, the cover of the title that lifts it most (AniList's `Studio` has no image); `coverColor`
   * shows while it loads or when there is none.
   */
  cover: string | null
  coverColor: string | null
  /** A banner from its best title that has one, else that cover. */
  banner: string | null
}

/** How a title pushed its studio or Director, in plain terms. */
export type Effect = 'lifted' | 'held back'
export type Strength = 'a lot' | 'some' | 'a little'

export type CountedTitle = {
  mediaId: number
  name: string
  cover: string | null
  /** The cover's main colour, shown while it loads or when there is no cover. */
  coverColor: string | null
  siteUrl: string
  /** W·(e^z − Ū): against the user's own average title, not leave-one-out (#89). */
  push: number
  effect: Effect
  /** Against the title that pushed this score most, either way. */
  strength: Strength
  /** How the user marked it: "scored 9 · ★ favourite", "dropped at ep 3, no score", … */
  how: string
  /** The score on the 10-point scale, or null when it counted without one. */
  score: number | null
  /** Its vote weight W: longer shows and rewatches weigh more, the titles of a long Franchise a little less. */
  weight: number
  favourite: boolean
  dropped: boolean
}

export type OpenEntry = {
  card: RankCard
  /** The mochi's sentence: how many titles beat the user's usual, and the one that lifted / held it back most. */
  summary: { beatUsual: number; of: number; best: string | null; worst: string | null }
  /** Up to 3, biggest lift first. */
  lifted: CountedTitle[]
  /** Up to 3, biggest hold-back first. */
  heldBack: CountedTitle[]
  /** Every counted title, biggest lift first. */
  titles: CountedTitle[]
  /**
   * The swarm's "your usual" mark on the 10-point scale: the score whose Vote is worth Ū, the line pushes are measured
   * from, so a plain scored title right of it lifted its score (a drop's z cap or the fav bonus can still move one).
   */
  usualScore: number
}

/** S at this or below shows no hearts. */
const HEART_FLOOR = -0.4
const HEARTS = 5
/** A push this share of the biggest one reads "a lot"; under the second, "a little". */
const A_LOT = 0.5
const A_LITTLE = 0.15
const SHOWN = 3

const pushOf = (vote: Vote, averageUtility: number) => vote.weight * (utility(vote.z) - averageUtility)

function byPush<V extends Vote>(who: { votes: V[] }, averageUtility: number): V[] {
  return [...who.votes].sort((a, b) => pushOf(b, averageUtility) - pushOf(a, averageUtility))
}

/**
 * The ranked from #1, then the watchlist. `picture` gives a card its picture; by default, the cover of the title that
 * lifts it most.
 */
export function rankCards(top: Ranking, picture: CardPicture = leadCover): RankCard[] {
  const best = Math.max(...top.ranked.map((s) => s.score), ...(top.ranked.length ? [] : top.watchlist.map((s) => s.score)))
  const card = (studio: WhoScore, rank: number | null): RankCard => {
    const votes = byPush(studio, top.averageUtility)
    const lead = votes[0]?.title
    return {
      id: studio.id,
      name: studio.name,
      rank,
      label: studio.label,
      score: studio.score,
      hearts: heartsOf(studio.score, best),
      votes: studio.votes.length,
      hitRate: studio.hitRate,
      flopRate: studio.flopRate,
      ...picture(studio, votes),
      banner: votes.find((v) => v.title.bannerUrl)?.title.bannerUrl ?? lead?.coverUrl ?? null,
    }
  }
  return [...top.ranked.map((s, i) => card(s, i + 1)), ...top.watchlist.map((s) => card(s, null))]
}

/** A card's picture, from who it is and its votes, biggest lift first. */
export type CardPicture = (who: WhoScore, byPush: Vote[]) => Pick<RankCard, 'cover' | 'coverColor'>

/** The cover of the title that lifts it most: a studio's picture. */
export const leadCover: CardPicture = (_, [lead]) => ({ cover: lead?.title.coverUrl ?? null, coverColor: lead?.title.coverColor ?? null })

function heartsOf(score: number, best: number): number {
  const span = best - HEART_FLOOR
  if (!(span > 0)) return score > HEART_FLOOR ? HEARTS : 0
  return Math.max(0, Math.min(HEARTS, Math.round(((score - HEART_FLOOR) / span) * HEARTS)))
}

/** The one with this id (ranked or on the watchlist) opened, or null when it isn't on the result. */
export function openEntry(top: Ranking, id: number, picture: CardPicture = leadCover): OpenEntry | null {
  const card = rankCards(top, picture).find((c) => c.id === id)
  const studio = [...top.ranked, ...top.watchlist].find((s) => s.id === id)
  if (!card || !studio) return null
  const votes = byPush(studio, top.averageUtility)
  const biggest = Math.max(...votes.map((v) => Math.abs(pushOf(v, top.averageUtility))))
  const titles = votes.map((v) => countedTitle(v, pushOf(v, top.averageUtility), biggest))
  const lifted = titles.filter((t) => t.push > 0)
  const heldBack = titles.filter((t) => t.push < 0).reverse()
  return {
    card,
    summary: { beatUsual: lifted.length, of: titles.length, best: lifted[0]?.name ?? null, worst: heldBack[0]?.name ?? null },
    lifted: lifted.slice(0, SHOWN),
    heldBack: heldBack.slice(0, SHOWN),
    titles,
    usualScore: scoreWorth(top.averageUtility, top.scale),
  }
}

function countedTitle(vote: Vote, push: number, biggest: number): CountedTitle {
  const { title } = vote
  const share = biggest > 0 ? Math.abs(push) / biggest : 0
  const dropped = isDropped(title)
  return {
    mediaId: title.mediaId,
    name: title.title.english ?? title.title.romaji,
    cover: title.coverUrl,
    coverColor: title.coverColor,
    siteUrl: title.siteUrl,
    push,
    effect: push >= 0 ? 'lifted' : 'held back',
    strength: share >= A_LOT ? 'a lot' : share < A_LITTLE ? 'a little' : 'some',
    how: howMarked(vote),
    score: vote.scored ? title.score : null,
    weight: vote.weight,
    favourite: vote.favourite,
    dropped,
  }
}

function howMarked({ title, favourite, scored }: Vote): string {
  const dropped = isDropped(title) ? `dropped at ep ${Math.max(title.progress, 1)}` : null
  const rewatched = rewatchesOf(title) > 0 ? 'rewatched' : null
  const fav = favourite ? '★ favourite' : null
  if (scored) return [`scored ${title.score}`, fav, dropped, rewatched].filter(Boolean).join(' · ')
  // Unscored, it counted through the one signal the user gave.
  return `${dropped ?? rewatched ?? fav}, no score`
}

/** A title's push in words: "lifted it a lot", "held it back", "lifted it a little". */
export function pushText({ effect, strength }: Pick<CountedTitle, 'effect' | 'strength'>): string {
  const verb = effect === 'lifted' ? 'lifted it' : 'held it back'
  return strength === 'some' ? verb : `${verb} ${strength}`
}
