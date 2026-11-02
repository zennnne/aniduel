// What the Top Studios result shows (#92, layout picked in #89): every studio as a card (rank, hearts, cover), and an
// opened studio's counted titles with how each pushed its score. Pure: the result components render it.
import type { StudioLabel, StudioScore, StudioVote, TopStudios } from '../loadTopStudios.ts'

export type StudioCard = {
  id: number
  name: string
  /** 1 for the user's top studio; null on the 🌱 watchlist. */
  rank: number | null
  label: StudioLabel
  /** The raw Studio Score S, shown only in a tooltip. */
  score: number
  /** S as 0–5 hearts, relative to the user's #1. */
  hearts: number
  titles: number
  hitRate: number
  flopRate: number
  /** The cover of the title that lifts it most: AniList's `Studio` has no image. */
  cover: string | null
  coverColor: string | null
  /** A banner from its best title that has one, else that cover. */
  banner: string | null
}

/** How a title pushed its studio, in plain terms. */
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
  /** Against the title that pushed this studio most, either way. */
  strength: Strength
  /** How the user marked it: "scored 9 · ★ favourite", "dropped at ep 3, no score", … */
  how: string
  /** The score on the 10-point scale, or null when it counted without one. */
  score: number | null
  /** Its vote weight W: longer shows and rewatches weigh more. */
  weight: number
  favourite: boolean
  dropped: boolean
}

export type OpenStudio = {
  card: StudioCard
  /** The mochi's sentence: how many titles beat the user's usual, and the one that lifted / held it back most. */
  summary: { beatUsual: number; of: number; best: string | null; worst: string | null }
  /** Up to 3, biggest lift first. */
  lifted: CountedTitle[]
  /** Up to 3, biggest hold-back first. */
  heldBack: CountedTitle[]
  /** Every counted title, biggest lift first. */
  titles: CountedTitle[]
  /** The user's mean score on the 10-point scale: the swarm's "your usual" mark. */
  usualScore: number
}

/** S at this or below shows no hearts. */
const HEART_FLOOR = -0.4
const HEARTS = 5
/** A push this share of the studio's biggest one reads "a lot"; under the second, "a little". */
const A_LOT = 0.5
const A_LITTLE = 0.15
const SHOWN = 3

const pushOf = (vote: StudioVote, averageUtility: number) => vote.weight * (Math.exp(vote.z) - averageUtility)

function byPush(studio: StudioScore, averageUtility: number): StudioVote[] {
  return [...studio.votes].sort((a, b) => pushOf(b, averageUtility) - pushOf(a, averageUtility))
}

/** The ranked studios from #1, then the watchlist. */
export function studioCards(top: TopStudios): StudioCard[] {
  const best = Math.max(...top.studios.map((s) => s.score), ...(top.studios.length ? [] : top.watchlist.map((s) => s.score)))
  const card = (studio: StudioScore, rank: number | null): StudioCard => {
    const votes = byPush(studio, top.averageUtility)
    const lead = votes[0]?.title
    return {
      id: studio.id,
      name: studio.name,
      rank,
      label: studio.label,
      score: studio.score,
      hearts: heartsOf(studio.score, best),
      titles: studio.votes.length,
      hitRate: studio.hitRate,
      flopRate: studio.flopRate,
      cover: lead?.coverUrl ?? null,
      coverColor: lead?.coverColor ?? null,
      banner: votes.find((v) => v.title.bannerUrl)?.title.bannerUrl ?? lead?.coverUrl ?? null,
    }
  }
  return [...top.studios.map((s, i) => card(s, i + 1)), ...top.watchlist.map((s) => card(s, null))]
}

function heartsOf(score: number, best: number): number {
  const span = best - HEART_FLOOR
  if (!(span > 0)) return score > HEART_FLOOR ? HEARTS : 0
  return Math.max(0, Math.min(HEARTS, Math.round(((score - HEART_FLOOR) / span) * HEARTS)))
}

/** The studio with this id (ranked or on the watchlist) opened, or null when it isn't on the result. */
export function openStudio(top: TopStudios, id: number): OpenStudio | null {
  const card = studioCards(top).find((c) => c.id === id)
  const studio = [...top.studios, ...top.watchlist].find((s) => s.id === id)
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
    usualScore: top.scale.mean,
  }
}

function countedTitle(vote: StudioVote, push: number, biggest: number): CountedTitle {
  const { title } = vote
  const share = biggest > 0 ? Math.abs(push) / biggest : 0
  const dropped = title.status === 'DROPPED'
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

function howMarked({ title, favourite, scored }: StudioVote): string {
  const dropped = title.status === 'DROPPED' ? `dropped at ep ${Math.max(title.progress, 1)}` : null
  const rewatched = title.repeat > 0 || title.status === 'REPEATING' ? 'rewatched' : null
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
