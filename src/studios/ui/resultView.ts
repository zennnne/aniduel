// What the Top Studios result shows (#92, layout picked in #89): the shared AniLyze cards and opened panel over
// Top Studios, each studio pictured by the cover of the title that lifts it most.
import { openEntry, rankCards, type OpenEntry, type RankCard } from '../../anilyze/ui/resultView.ts'
import type { TopStudios } from '../loadTopStudios.ts'
import { rankingOf } from '../scoring.ts'

export { pushText, type CountedTitle, type Effect, type Strength } from '../../anilyze/ui/resultView.ts'

export type StudioCard = RankCard
export type OpenStudio = OpenEntry

/** The ranked studios from #1, then the watchlist. */
export const studioCards = (top: TopStudios): StudioCard[] => rankCards(rankingOf(top))

/** The studio with this id (ranked or on the watchlist) opened, or null when it isn't on the result. */
export const openStudio = (top: TopStudios, id: number): OpenStudio | null => openEntry(rankingOf(top), id)
