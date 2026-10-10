// The exit offer (#52, UI decisions on #37): a green button in Catch-up's header, once titles were added this visit,
// that leads on to ranking them. No Done modal, no end card, no prompt when leaving.

/** What the user saved in this visit to Catch-up, and whether their anime list has a scale to score against. */
export type ExitOfferInput = {
  /** Titles saved with a mark (Completed, Dropped, Planning or Paused all count). */
  added: number
  /**
   * Whether the user qualifies for Score New Titles (`newTitlesEligibility` on their anime list's Anchors); null
   * while that list isn't read yet.
   */
  eligibleForNewTitles: boolean | null
}

/**
 * `score-new-titles`: on to Start with Score New Titles picked, to place the added titles on the user's own scale.
 * `default-sort-goal`: on to Start with the Pool-size default Sort Goal, to build that scale first.
 */
export type ExitOffer = { target: 'score-new-titles' | 'default-sort-goal'; label: string }

/**
 * The offer for this visit, or null before anything was added or while it isn't known where it should lead. The
 * single place that decides where leaving Catch-up leads.
 */
export function exitOffer(input: ExitOfferInput): ExitOffer | null {
  if (input.added === 0 || input.eligibleForNewTitles === null) return null
  if (!input.eligibleForNewTitles) return { target: 'default-sort-goal', label: 'Start Rough Sort →' }
  return { target: 'score-new-titles', label: `Score ${input.added} new ${input.added === 1 ? 'title' : 'titles'} →` }
}
