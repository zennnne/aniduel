# The Duel log is the source of truth, and the Ranking is built by binary insertion

We store every Duel answer in order as an append-only log and rebuild the Ranking by replaying it through binary insertion sort. We do not store sort state, and we do not use Elo or Glicko ratings. Replaying the log is what lets us undo several steps, resume after closing the tab, Re-rank a title, move it to another Band, and add new titles after an Import, all with one mechanism. Binary insertion also needs close to the fewest comparisons possible and has a clear end, so we can show progress.

## Considered Options

- **Elo/Glicko with random pairs**: you can stop at any time and it tolerates inconsistent answers, but it needs far more Duels before the order settles and has no clear end. We rejected it because the target user has 200+ titles and the Duel count is already the main pain point.
- **Hybrid that starts from existing scores**: we rejected it because our target users are new to AniList and usually have no scores yet.

## Consequences

- A single wrong answer puts a title in the wrong place for good, so undo and Re-rank are required features, not optional ones.
- Any change to the insertion algorithm must still replay old logs the same way, or saved progress breaks. Version both the log format and the engine (ADR 0005).
- How removals, Undo and sync work without rewriting the log is set out in ADR 0005.
