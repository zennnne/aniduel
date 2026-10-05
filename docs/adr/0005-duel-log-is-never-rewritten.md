# The Duel log is never rewritten; removing a title only takes it out of the derived Ranking

ADR 0001 makes the Duel log the source of truth and rebuilds the Ranking by replaying it. The first version of the spec also said that "Band moved" and "Re-rank requested" drop the title's earlier Duel answers, and that Undo removes the last answer. Both break replay: a title being moved was also the pivot in other titles' binary insertions, so deleting its answers changes the questions those titles are asked, and every later answer stops matching its prompt.

So the log is never edited and no event is ever deleted. Replay is a state machine that applies events one at a time. Once a Duel answer has been applied, it is a historical fact: it already moved a title into place, and nothing later reaches back to "un-apply" it except Undo.

## Rules

- **Membership comes from the log.** The first Pool load is itself a `titles added` event. Which titles exist, and the order Rough Sort shows them in, come only from `titles added` / `titles removed` events, in the order their ids are listed. The Pool fetched from AniList is used for display data only.
- **Log header.** The log starts with a header holding the log format version, the engine version, the seed, the AniList user id and the Media Type. The engine refuses a log whose engine version it doesn't know, rather than replaying it differently.
- **Duel answers are stored by id**: `{a, b, result: a | b | tie}`, never as left/right or as a position. On replay the engine checks that `{a, b}` is exactly the pair it would prompt next; if not, the log is corrupt and replay stops with an error.
- **Left/right is display only.** Which card is on the left is `hash(seed, min(a,b), max(a,b))`, so it never affects replay.
- **Taking a title out.** `Band moved`, `Re-rank requested`, `Forgotten` and `titles removed` all take the title out of wherever it currently is (its Tier, a Band's insertion queue, or the Rough Sort queue). An emptied Tier disappears. Every other title keeps its relative order, which is still valid because it came from answers about those titles.
- **Where it goes next.**
  - `Band moved`: to the front of the new Band's insertion queue.
  - `Re-rank requested`: to the front of its own Band's insertion queue.
  - `Unforgotten`: to the front of its last Band's insertion queue, or to the front of the Rough Sort queue if it never had a Band.
  - `Forgotten`: into the Forgotten set.
  - `titles removed`: gone. If the same title is added again later, it is a new title and starts from Rough Sort.
  - After `Band moved`, `Re-rank requested` and `Unforgotten`, the next prompt is that title's insertion, so the user places it straight away.
- **An insertion in progress keeps what it knows.** A title being inserted holds two bounds: the Tier it is known to be worse than and the Tier it is known to be better than. If a title is taken out of the Band mid-insertion, the bounds stay. If a bound Tier disappears, that bound moves one Tier further out, which is still true by transitivity. The next pivot is then the middle of the remaining interval.
- **Tier pivots.** When the pivot is a Tier, the card shows the member that was inserted into it first and is still present. A Tier never spans two Bands or two Sub-bands (ADR 0006).
- **Undo** is an event, not a deletion. It cancels the most recent user event that hasn't already been cancelled. User events are `Band assigned`, `Duel answered`, `Forgotten`, `Unforgotten`, `Band moved`, `Re-rank requested` and `Band split` (ADR 0006). Wherever these rules say "Band", a Sub-band works the same way. `Band selected` is navigation and is skipped over, neither undone nor blocking: it is never a step of its own, but a `Band selected` made after the event an Undo cancels is cancelled with it, because it was chosen from a state that no longer exists. That way Undo always returns to the prompt the cancelled answer was given at, e.g. the last Duel of a Band that had just finished. System events (`titles added` and `titles removed` from sync) can't be undone and act as a barrier: Undo never cancels anything before them. Undo with nothing left to cancel does nothing. There is no redo.
  - Because cancelled events are simply skipped on replay, undoing a `Band moved` brings the title back to exactly where it was, since its old answers are still in the log.

## Considered Options

- **Delete the title's answers and replay from the start** (the original spec): we rejected this because the answers are shared with other titles' insertions, so replay drifts.
- **Store a snapshot of the Ranking and edit it directly**: this is simpler for removals, but it loses multi-step Undo across removals and goes against ADR 0001.
- **Restart an in-progress insertion from scratch when its interval changes**: simpler, but it throws away answers the user already gave. Keeping the bounds costs a few lines.

## Consequences

- The log only grows. Re-ranking a title adds a few events and never shrinks the log, which is fine at this size (hundreds to low thousands of events).
- Changing the insertion algorithm means bumping the engine version and either keeping the old replayer or migrating logs on purpose. Keep a golden log in the tests that must replay to a fixed Ranking.
- Progress and the "next prompt" are derived the same way as the Ranking, so they need no separate storage.
