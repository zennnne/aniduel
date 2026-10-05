# Split an oversized Band into three Sub-bands instead of changing the engine

Most of the Duel count comes from one oversized Band, not from the engine. A beginner puts 150 of 200 titles into 😍, and binary insertion over that Band alone is most of the ~1,000 Duels. After Rough Sort, we offer to split a Band that is too large into three Sub-bands (shown as Best / Middle / Lowest). This is a second Rough Sort pass over that Band only. Each Sub-band is a fixed boundary in the Ranking, just like a Band, so the insertion engine (ADR 0001) and the replay rules (ADR 0005) stay the same. The Band itself still exists: there are still five Bands, the histogram and score ranges stay per Band (ADR 0002), and Preview ignores Sub-bands.

## Rules

- **Offer threshold.** We only offer a split when a Band holds at least 90 titles that don't have a place in the Ranking yet. The estimate shown is the worst-case insertion count Σ⌈log₂(i+1)⌉, assuming a ¼ / ½ / ¼ split, and it is labelled "up to". With Tiers, real savings run about 15–30% below that estimate, which is why the threshold is 90 and not the 68 where the estimate first reaches 100. The same split can be offered later from the menu under the same rule. A Band is split at most once, and in v1 there is no way to merge its Sub-bands back.
- **One event per split.** `Band split` is a single user event that carries the whole result:
  - **Already-ranked titles** are cut by their existing order. The event stores the two cut points, not a `Band moved` per title, because moving a title out and back in would lose the place its Duels earned. Cut points always fall on a Tier edge, so no Tier spans two Sub-bands.
  - **Titles without a place yet** are stored with the Sub-band the user put them in.
  - **A title in the middle of an insertion** counts as unplaced. It keeps any bound that falls inside its new Sub-band and drops the rest.
- **Afterwards, a Sub-band is just a destination.** `Band assigned`, `Band moved` and `Unforgotten` can target a Sub-band. A new or returning title that lands in a split Band gets a second tap in Rough Sort to pick its Sub-band. Defaulting it to Middle would let Middle grow back.
- **Undo** cancels `Band split` as one step, like any other user event, back to the last sync.

## Considered Options

- **Score-level aware sorting** (sort only finely enough to fix each title's score): rejected. In simulation it saved only 10–15% on POINT_10 and nothing once the user changed best/worst or the Distribution. It also made the next prompt depend on the settings, and it broke ADR 0005, because removing one title shifted every score boundary. _Revisited in ADR 0007:_ the low savings came from the algorithm. With a better one and whole-point scores it saves 27–42%, and it now ships as the Scores Sort Goal, with the settings stored in the Duel log.
- **Random spot-check Duels to catch wrong answers**: rejected. They caught only about 40% of real misplacements and raised more false alarms than true ones.
- **More Bands from the start** (for example 7 buttons): rejected. Beginners still pile titles into the top button.
- **Split on the first tap** (ask "how much?" right after 😍): rejected. Every user would pay a second tap, even when no Band ends up oversized.
- **Five Sub-bands**: saves more (about 330 vs 220 Duels for 150 titles), but sorting covers into three columns is much simpler.

## Consequences

- A wrong split tap becomes a hard boundary until the user moves that title. Move therefore has to reach Sub-bands directly.
- The engine version must be bumped when `Band split` is introduced (ADR 0005). `Band split` and Sub-band targets came with version 2; later versions add other events (the current one is `ENGINE_VERSION` in `src/ranking/engine.ts`). Each version replays every older log exactly as before, so the engine accepts all of them, but refuses `Band split` or a Sub-band target in a log whose header says 1. Appending any event stamps the current version on the header, so an older app refuses the log instead of silently skipping a split it doesn't know.
- Simulations used for this decision: 200 titles on POINT_10 with a 150/12/12/13/13 Rough Sort; with Tiers, splitting saves about 150–220 Duels.
