// Starting era (#51): roughly when the user started watching anime, asked by Catch-up while the list is near empty.
// Stored per user under their anime progress, so logout deletes it with the rest.
import type { Era } from '../anilist/candidates.ts'
import { animeProgressKey, loadProgressPart, saveProgressPart } from '../persistence/progress.ts'

/** A year, or null for "Skip — show all-time favourites". */
export type StartingEraAnswer = number | null

export type StartingEraStore = {
  /** The saved answer, or undefined when the user hasn't answered (or it can't be read). */
  answer(): StartingEraAnswer | undefined
  save(answer: StartingEraAnswer): void
}

/** The slider's ends: the earliest year means "this or before". */
export const EARLIEST_STARTING_YEAR = 1995
export const DEFAULT_STARTING_YEAR = 2012

/** How far either side of the answered year counts as "around" it. */
const AROUND_YEARS = 2

const key = (userId: number) => animeProgressKey(userId, 'catchup-starting-era')

export function createStartingEraStore(storage: Storage, userId: number): StartingEraStore {
  return {
    answer() {
      const raw = loadProgressPart(storage, key(userId))
      if (raw === null) return undefined
      try {
        const { year } = JSON.parse(raw) as { year?: unknown }
        if (year === null || (typeof year === 'number' && Number.isInteger(year))) return year
      } catch {
        // unreadable: as if never answered
      }
      return undefined
    },
    save(answer) {
      saveProgressPart(storage, key(userId), JSON.stringify({ year: answer }))
    },
  }
}

/** The years an answer stands for: around the year, or every year (null) when skipped. */
export function startingEraYears(answer: StartingEraAnswer): Era | null {
  if (answer === null) return null
  const from = answer <= EARLIEST_STARTING_YEAR ? 1900 : answer - AROUND_YEARS
  return { from, to: answer + AROUND_YEARS }
}

/** The era chip's text: "around 2012", "1995 or before", "all eras". */
export function startingEraLabel(answer: StartingEraAnswer): string {
  if (answer === null) return 'all eras'
  return answer <= EARLIEST_STARTING_YEAR ? `${EARLIEST_STARTING_YEAR} or before` : `around ${answer}`
}
