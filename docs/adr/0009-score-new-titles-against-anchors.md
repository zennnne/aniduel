# Score New Titles: a third Sort Goal that scores unscored titles against fixed Anchors

_Amended by [ADR 0011](0011-keep-my-scale-a-hand-picked-pool.md): the goal is now called Keep My Scale, its Pool is picked by hand and can hold scored titles (so a Suspect Anchor can be scored again by picking it), a picked title is never an Anchor, and sync no longer adds titles._

_Amended by [ADR 0012](0012-keep-my-scale-a-split-on-a-score-is-not-asked.md): a title that both beat and lost to Anchors of a score, and ends up next to that score, gets it without the Closer-to prompt, and an Anchor is Suspect only when the titles that contradicted it are most of the titles settled against it._

_Amended by [ADR 0013](0013-keep-my-scale-deciding-duels-before-the-closer-to-prompt.md): the user can choose, per Ranking, to have a title that lands between two scores meet up to four more Anchors of them before the Closer-to prompt is asked._

Users who already have their own scoring scale don't want it rescaled; they want the titles they never scored to get scores on that same scale. Every other Sort Goal turns Ranking positions into scores through a Distribution (ADR 0002/0003), which rewrites every score. **Score New Titles** works the other way round: titles that already have an AniList score are Anchors with fixed scores, and each unscored title gets the score of the Anchors it sits among, found by Duels against Anchors only. We call it a Sort Goal because to the user it is a different goal for the sort, even though it can't be switched to or from the other two.

## Rules

- **Chosen only when a Ranking starts**, and only offered with at least 20 Anchors on at least 3 distinct scores. It can't be switched with Scores or Full Ranking, because its Pool (unscored titles) and its scoring (Anchor scores) differ from theirs.
- **No Rough Sort, no Board, no Bands.** Duels start straight away, always a new title against an Anchor.
- **Anchors** are every title in the list with a score, any status. Targets are the unscored titles of the chosen statuses (default Completed + Repeating).
- **Scores come from Anchors only.** A title gets an existing Anchor score. If it beats every Anchor of one score and loses to every Anchor of the next, the user is asked once which of the two it is closer to. "About the same" with an Anchor gives that Anchor's score. Above every Anchor (or below every one) it gets one human Score Step past the extreme Anchor score, all such titles together, and never beyond the Score Format's ends.
- **Scores stay in the snapshot's Score Format.** The Anchor snapshot holds the Score Format it was taken in, and a title is written as the `scoreRaw` of its level in that format (ADR 0003's table), so it stores the same raw as the Anchors of its score. If the user changes their Score Format on AniList during the Ranking, nothing is recalculated, unlike the other Sort Goals (ADR 0003): Preview shows each score at the new format, and the raw written is still the snapshot's, so a 7.5 taken on 10 points with decimals is written as raw 75 on plain 10 points too, where AniList shows it as 7.
- **Confirmation.** A boundary is passed only when two different Anchors agree; if they disagree a third decides. A score with a single Anchor is confirmed against the neighbouring score's Anchors instead.
- **Suspect Anchors.** An Anchor whose results contradict its own score twice stops being used as a reference and is listed in Preview, under the score rows. Its score is never changed. Forgotten on an Anchor also just stops using it.
- **The Anchors are one event.** Their scores are snapshotted into the Duel log when the Ranking starts, as in ADR 0008, so replay never reads AniList. Sync can add new unscored titles but never new Anchors or changed Anchor scores. Engine version is bumped (ADR 0005). The snapshot is a barrier for Undo, and a Closer-to answer is undone like a Duel answer (ADR 0005).
- best/worst, Distribution and Score Step settings are hidden under this goal; Preview groups titles by score like Scores.

## Considered Options

- **A separate kind of Ranking chosen on Start, not a Sort Goal**: keeps "Sort Goal" meaning only "how far the Duels go", but users read it as just another goal. Rejected for clarity to users.
- **A probability model (Bradley–Terry/Elo with Anchor scores as priors)**: fewer Duels in theory, but hard to explain, replay and tune.
- **New levels between Anchor scores (e.g. 7.5 between 7 and 8)**: rejected; this goal is for users who already have a scale, so it should only reuse it.
- **Refresh Anchors on sync**: rejected; replay would depend on when the sync happened.

## Consequences

- About twice the Duels of a plain binary search over Anchor scores, the price of confirming each boundary.
- A user whose old scores drifted sees it as Suspect Anchors, but has to fix those through Scores or Full Ranking (or on AniList); this goal never rescores them.
