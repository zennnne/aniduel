import { count } from '../meta.ts'

/**
 * The unsettled card's summary on Preview (#29). Titles get unsettled by a settings change, Forgotten, a sync, a Band
 * move or a Re-rank, so the copy names no cause.
 */
export function unsettledSummary(titles: number, refineDuels: number): string {
  return `${count(titles, 'title')} not settled yet · about ${count(refineDuels, 'Refine Duel')}`
}
