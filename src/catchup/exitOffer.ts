// The exit offer (#52, UI decisions on #37): a green button in Catch-up's header, once titles were added this visit,
// that leads on to ranking them. No Done modal, no end card, no prompt when leaving.

/** What the user saved in this visit to Catch-up. */
export type ExitOfferInput = {
  /** Titles saved with a mark (Completed, Dropped, Planning or Paused all count). */
  added: number
}

/** `sort-goal`: back to Start to pick a Sort Goal and rank the list the added titles joined. */
export type ExitOffer = { target: 'sort-goal'; label: string }

/**
 * The offer for this visit, or null before anything was added. The single place that decides where leaving Catch-up
 * leads: Score New Titles (#43, for a user who qualifies) and the Pool-size default Sort Goal (#38) belong here.
 */
export function exitOffer(input: ExitOfferInput): ExitOffer | null {
  if (input.added === 0) return null
  return { target: 'sort-goal', label: 'Start ranking →' }
}
