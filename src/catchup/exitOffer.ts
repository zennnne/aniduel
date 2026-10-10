// The exit offer (#52, UI decisions on #37): a green button in Catch-up's header, once titles were added this visit,
// that leads on to ranking them. No Done modal, no end card, no prompt when leaving.

/** Where the user's anime stands, as Start would show it. */
export type AnimeStanding = {
  /** Whether the user qualifies for Score New Titles (`newTitlesEligibility` on their anime list's Anchors). */
  eligibleForNewTitles: boolean
  /** The titles Score New Titles would rank: the count on Start's New Titles button. */
  unscored: number
  /** The anime Ranking saved in this browser: none, a Score New Titles one, or one on another Sort Goal. */
  saved: 'none' | 'new-titles' | 'other'
}

export type ExitOfferInput = {
  /** Titles saved with a mark in this visit (Completed, Dropped, Planning or Paused all count). */
  added: number
  /** Null while the anime list isn't read yet, or its saved progress can't be used. */
  anime: AnimeStanding | null
}

/**
 * Every target is Start on anime:
 * `score-new-titles`: with Score New Titles picked, to place the new titles on the user's own scale.
 * `replace-with-new-titles`: asking to replace the saved Ranking with a Score New Titles one (#46).
 * `saved-ranking`: with the saved Ranking as it is, to continue it.
 * `default-sort-goal`: with the Pool-size default Sort Goal, to build that scale first.
 */
export type ExitOffer = {
  target: 'score-new-titles' | 'replace-with-new-titles' | 'saved-ranking' | 'default-sort-goal'
  label: string
}

/**
 * The offer for this visit, or null before anything was added or while it isn't known where it should lead. The
 * single place that decides where leaving Catch-up leads.
 */
export function exitOffer({ added, anime }: ExitOfferInput): ExitOffer | null {
  if (added === 0 || !anime) return null
  if (anime.eligibleForNewTitles && anime.unscored > 0) {
    const label = `Score ${anime.unscored} new ${anime.unscored === 1 ? 'title' : 'titles'} →`
    if (anime.saved === 'none') return { target: 'score-new-titles', label }
    return { target: anime.saved === 'new-titles' ? 'saved-ranking' : 'replace-with-new-titles', label }
  }
  if (anime.saved !== 'none') return { target: 'saved-ranking', label: 'Continue ranking →' }
  return { target: 'default-sort-goal', label: 'Start Rough Sort →' }
}
