// The exit offer (#52, UI decisions on #37): a green button in Catch-up's header, once titles were added this visit,
// that leads on to ranking them. No Done modal, no end card, no prompt when leaving.

/** Where the user's anime stands, as Start would show it. */
export type AnimeStanding = {
  /** Whether the user qualifies for Keep My Scale (`keepMyScaleEligibility` on their anime list's Anchors). */
  eligibleForKeepMyScale: boolean
  /** The titles Keep My Scale would rank: the count on Start's Keep My Scale button. */
  unscored: number
  /** The anime Ranking saved in this browser: none, a Keep My Scale one, or one on another Sort Goal. */
  saved: 'none' | 'keep-my-scale' | 'other'
}

export type ExitOfferInput = {
  /** Titles saved with a mark in this visit (Completed, Dropped, Planning or Paused all count). */
  added: number
  /** Null while the anime list isn't read yet or doesn't have the titles just saved, or its saved progress can't be used. */
  anime: AnimeStanding | null
}

/**
 * Every target is on anime:
 * `picker`: the Picker for Keep My Scale with every unscored Completed and Repeating title ticked (#65), to place them
 * on the user's own scale. Over a saved Scores or Full Ranking Ranking, the Picker's Confirm asks to replace it (#46).
 * `saved-ranking`: Start with the saved Ranking as it is, to continue it. A Keep My Scale one never takes in titles
 * after it started (ADR 0011), so the titles just added wait for the next one.
 * `default-sort-goal`: Start with the Pool-size default Sort Goal, to build that scale first.
 */
export type ExitOffer = {
  target: 'picker' | 'saved-ranking' | 'default-sort-goal'
  label: string
}

/**
 * The offer for this visit, or null before anything was added or while it isn't known where it should lead. The
 * single place that decides where leaving Catch-up leads.
 */
export function exitOffer({ added, anime }: ExitOfferInput): ExitOffer | null {
  if (added === 0 || !anime) return null
  if (anime.eligibleForKeepMyScale && anime.unscored > 0 && anime.saved !== 'keep-my-scale') {
    return { target: 'picker', label: `Score ${anime.unscored} ${anime.unscored === 1 ? 'title' : 'titles'} →` }
  }
  if (anime.saved !== 'none') return { target: 'saved-ranking', label: 'Continue ranking →' }
  return { target: 'default-sort-goal', label: 'Start Rough Sort →' }
}
