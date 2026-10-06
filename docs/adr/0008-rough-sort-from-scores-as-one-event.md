# Rough Sort from Scores is one event that carries every Band choice

Users who already scored most of their list want to rescale it, not tap 200 covers. Rough Sort from Scores lets the app do the Rough Sort: every title with an AniList score goes into a Band by how far its score sits from the user's own average. Titles without a score still go through Rough Sort by hand, and Duels follow as usual. Bands still decide order only (ADR 0002). The Board is shown after Rough Sort so the user can check the result and move any title before the first Duel.

## Rules

- **Offered at the start of every new Ranking**, with "X of Y titles have a score" and the drawbacks: titles in different Bands are never compared, so a wrong Band has to be fixed on the Board. Below 80% scored, a red warning says it isn't recommended. If every score is the same (SD = 0), it isn't offered. Before confirming, the user sees how many titles each Band would get.
- **Cut by z-score of the old score**, using the mean and SD of the user's scored titles in the Pool: z ≥ +1.5 Loved, +0.5..+1.5 Liked, −0.5..+0.5 Okay, −1.5..−0.5 Meh, ≤ −1.5 Hated. Equal scores get equal z, so they always share a Band. Score Formats with few levels (3 smileys, 5 stars) may fill only some Bands, and that's allowed.
- **One event.** `bands from scores` stores the Band of every title it placed, by id. Replay never reads AniList scores, so a later score change or sync can't change the result.
- **Undo** cancels it as one step, like `Band split` (ADR 0006).
- **Engine version is bumped** (ADR 0005). An older app refuses a log that contains the event.

## Considered Options

- **One `Band assigned` per title**: no engine change, but Undo would step back one title at a time, so cancelling the whole thing takes 200 Undos.
- **Store only the rule and recompute from AniList scores on replay**: smaller log, but replay would depend on data outside the log, which ADR 0001/0005 forbid.
- **Fixed bell shares (10/20/40/20/10%) by old-score order**: keeps Band sizes predictable, but a large block of equal scores bends the shares, and it ignores how the user actually scores. Rejected in favour of z-scores.
- **Fixed score ranges (9–10 Loved, ...)**: a user who scores everything 8–10 piles into Loved, which is the same problem as a beginner's hand Rough Sort.
- **Build the whole Ranking from old scores with no Duels**: rejected. Rescaling means re-judging through Duels, and equal old scores would make huge Tiers.

## Consequences

- Titles in the wrong Band are never compared with the right neighbours. The Board after Rough Sort, which closes at the first Duel answer, is the cheap place to fix that. After that, Move in the Duel screen still works but costs Duels.
- The split offer (ADR 0006) still runs on the resulting Band sizes. A Band of 40% Okay may be offered a split.
