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
 * Every target is Start on anime:
 * `keep-my-scale`: with Keep My Scale picked, to place the titles without a score on the user's own scale.
 * `replace-with-keep-my-scale`: asking to replace the saved Ranking with a Keep My Scale one (#46).
 * `saved-ranking`: with the saved Ranking as it is, to continue it.
 * `default-sort-goal`: with the Pool-size default Sort Goal, to build that scale first.
 */
export type ExitOffer = {
  target: 'keep-my-scale' | 'replace-with-keep-my-scale' | 'saved-ranking' | 'default-sort-goal'
  label: string
}

/**
 * The offer for this visit, or null before anything was added or while it isn't known where it should lead. The
 * single place that decides where leaving Catch-up leads.
 */
export function exitOffer({ added, anime }: ExitOfferInput): ExitOffer | null {
  if (added === 0 || !anime) return null
  if (anime.eligibleForKeepMyScale && anime.unscored > 0) {
    const label = `Score ${anime.unscored} ${anime.unscored === 1 ? 'title' : 'titles'} →`
    if (anime.saved === 'none') return { target: 'keep-my-scale', label }
    return { target: anime.saved === 'keep-my-scale' ? 'saved-ranking' : 'replace-with-keep-my-scale', label }
  }
  if (anime.saved !== 'none') return { target: 'saved-ranking', label: 'Continue ranking →' }
  return { target: 'default-sort-goal', label: 'Start Rough Sort →' }
}
