// What the Top Studios result shows (#92, layout picked in #89): the studios as cards, and an opened studio's titles.
import { describe, expect, it } from 'vitest'
import type { StudioLabel, StudioScore, StudioVote, TopStudios } from '../loadTopStudios.ts'
import type { StudioTitle } from '../types.ts'
import { openStudio, pushText, studioCards } from './resultView.ts'

let nextId = 1
type TitleOptions = Partial<StudioTitle> & { name?: string }

function title({ name, ...options }: TitleOptions = {}): StudioTitle {
  const mediaId = options.mediaId ?? nextId++
  return {
    mediaId,
    status: 'COMPLETED',
    score: 0,
    progress: 12,
    repeat: 0,
    episodes: 12,
    duration: 24,
    studios: [],
    relations: [],
    title: { romaji: name ?? `Romaji ${mediaId}`, english: name ? null : `Title ${mediaId}`, native: null },
    coverUrl: `https://img/${mediaId}.jpg`,
    coverColor: null,
    bannerUrl: null,
    siteUrl: `https://anilist.co/anime/${mediaId}`,
    ...options,
  }
}

const vote = (z: number, weight = 1, options: TitleOptions = {}, flags: Partial<StudioVote> = {}): StudioVote => ({
  title: title({ score: 7, ...options }),
  z,
  weight,
  favourite: false,
  scored: (options.score ?? 7) > 0,
  ...flags,
})

function studio(id: number, score: number, votes: StudioVote[] = [vote(0)], label: StudioLabel = 'reliable'): StudioScore {
  return { id, name: `Studio ${id}`, score, votes, hitRate: 0.25, flopRate: 0.1, label }
}

function topStudios(studios: StudioScore[], watchlist: StudioScore[] = [], averageUtility = 1): TopStudios {
  return {
    studios,
    watchlist,
    gate: 6,
    labelLines: { hit: 0.2, flop: 0.2 },
    averageUtility,
    scale: { mean: 6.2, sd: 1.5 },
    scoredCount: 10,
    watchedCount: 10,
    countedCount: 10,
    countedScoredCount: 10,
  }
}

describe('the studios as cards', () => {
  it('ranks the studios from #1 and puts the watchlist after them, unranked', () => {
    const cards = studioCards(topStudios([studio(1, 0.6), studio(2, 0.1)], [studio(3, 1)]))

    expect(cards.map((c) => [c.id, c.rank])).toEqual([
      [1, 1],
      [2, 2],
      [3, null],
    ])
  })

  it('shows the Studio Score as 0–5 hearts relative to the user’s #1, from −0.4 up', () => {
    const cards = studioCards(topStudios([studio(1, 0.6), studio(2, 0.1), studio(3, -0.4), studio(4, -1)], [studio(5, 1)]))

    // round((S + 0.4) / (0.6 + 0.4) × 5): #1 is 5, 0.1 is 2.5 → 3, −0.4 and below 0; a watchlist studio above #1 stays 5.
    expect(cards.map((c) => c.hearts)).toEqual([5, 3, 0, 0, 5])
  })

  it('shows each studio by the title that lifts it most, its banner from the best title that has one', () => {
    const best = vote(2, 1, { bannerUrl: null })
    const second = vote(1, 1, { bannerUrl: 'https://banner/second.jpg' })
    const cards = studioCards(topStudios([studio(1, 0.5, [vote(-1), second, best])]))

    expect(cards[0].cover).toBe(best.title.coverUrl)
    expect(cards[0].banner).toBe('https://banner/second.jpg')
  })
})

describe('an opened studio', () => {
  it('measures each title against the user’s own average: W·(e^z − Ū)', () => {
    const top = topStudios([studio(1, 0.5, [vote(Math.log(3), 2), vote(0, 1)])], [], 2)
    const opened = openStudio(top, 1)!

    // 2 × (3 − 2) = +2 lifts it; 1 × (1 − 2) = −1 holds it back.
    expect(opened.titles.map((t) => t.push)).toEqual([expect.closeTo(2, 12), expect.closeTo(-1, 12)])
    expect(opened.titles.map((t) => t.effect)).toEqual(['lifted', 'held back'])
  })

  it('lists the 3 titles that lifted it most and the 3 that held it back most', () => {
    const zs = [2, 1.5, 1, 0.5, -0.5, -1, -1.5, -2]
    const votes = zs.map((z) => vote(z, 1, { name: `z ${z}` }))
    const opened = openStudio(topStudios([studio(1, 0.5, votes)]), 1)!

    expect(opened.lifted.map((t) => t.name)).toEqual(['z 2', 'z 1.5', 'z 1'])
    expect(opened.heldBack.map((t) => t.name)).toEqual(['z -2', 'z -1.5', 'z -1'])
    expect(opened.titles).toHaveLength(8)
  })

  it('lists only the titles that counted, so left-out ones never show', () => {
    // The scoring keeps only counted titles as votes; the panel shows exactly those.
    const votes = [vote(1), vote(-1)]
    const opened = openStudio(topStudios([studio(1, 0.5, votes)]), 1)!

    expect(opened.titles.map((t) => t.mediaId).sort()).toEqual(votes.map((v) => v.title.mediaId).sort())
  })

  it('says in plain terms how the user marked each title: score, favourite, drop, rewatch', () => {
    const votes = [
      vote(1.5, 1, { score: 9 }, { favourite: true }),
      vote(-1, 1, { score: 0, status: 'DROPPED', progress: 3 }),
      vote(0.5, 1, { score: 0, repeat: 1 }),
      vote(-0.5, 1, { score: 4.5, status: 'DROPPED', progress: 5 }),
      vote(0.5, 1, { score: 0 }, { favourite: true }),
    ]
    const opened = openStudio(topStudios([studio(1, 0.5, votes)]), 1)!
    const how = (v: StudioVote) => opened.titles.find((t) => t.mediaId === v.title.mediaId)!.how

    expect(votes.map(how)).toEqual([
      'scored 9 · ★ favourite',
      'dropped at ep 3, no score',
      'rewatched, no score',
      'scored 4.5 · dropped at ep 5',
      '★ favourite, no score',
    ])
  })

  it('says how strongly each title pushed, against the title that pushed the studio most', () => {
    const votes = [vote(Math.log(5)), vote(Math.log(2)), vote(Math.log(1.2)), vote(Math.log(0.5))]
    const opened = openStudio(topStudios([studio(1, 0.5, votes)]), 1)!

    // Pushes +4, +1, +0.2, −0.5 against Ū 1: a lot from half the biggest, a little under 15% of it.
    expect(opened.titles.map((t) => t.strength)).toEqual(['a lot', 'some', 'a little', 'a little'])
    expect(opened.titles.map(pushText)).toEqual(['lifted it a lot', 'lifted it', 'lifted it a little', 'held it back a little'])
  })

  it('sums the studio up: its rank, how many titles beat the user’s usual, and the best and worst of them', () => {
    const votes = [vote(1, 1, { name: 'Best' }), vote(0.5, 1, { name: 'Good' }), vote(-1, 1, { name: 'Worst' })]
    const opened = openStudio(topStudios([studio(9, 0.9), studio(1, 0.5, votes)]), 1)!

    expect(opened.card.rank).toBe(2)
    expect(opened.summary).toEqual({ beatUsual: 2, of: 3, best: 'Best', worst: 'Worst' })
  })

  it('opens a watchlist studio too, and nothing for an id that isn’t on the result', () => {
    const top = topStudios([studio(1, 0.5)], [studio(2, 0.8)])
    expect(openStudio(top, 2)?.card.rank).toBeNull()
    expect(openStudio(top, 3)).toBeNull()
  })

  it('gives the user’s usual score for the swarm, and each scored title’s place and size on it', () => {
    const votes = [vote(1, 2, { score: 8 }), vote(0.5, 0.5, { score: 0, repeat: 1 })]
    const opened = openStudio(topStudios([studio(1, 0.5, votes)]), 1)!

    expect(opened.usualScore).toBe(6.2)
    expect(opened.titles.map((t) => [t.score, t.weight])).toEqual([
      [8, 2],
      [null, 0.5],
    ])
  })

  it('puts the usual mark at the score worth the user’s average vote utility, the line between lifted and held back', () => {
    // Ū = e^0.4: the average vote sits at z 0.4, so on a 6.2 ± 1.5 scale the usual mark is 6.8, not the mean 6.2.
    const votes = [vote(0.6, 1, { score: 7.1, name: 'Above' }), vote(0.2, 1, { score: 6.5, name: 'Between' })]
    const opened = openStudio(topStudios([studio(1, 0.5, votes)], [], Math.exp(0.4)), 1)!

    expect(opened.usualScore).toBeCloseTo(6.8, 10)
    expect(opened.lifted.map((t) => t.name)).toEqual(['Above'])
    expect(opened.heldBack.map((t) => t.name)).toEqual(['Between'])
  })
})
