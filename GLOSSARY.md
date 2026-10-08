# AniDuel!

Helps AniList users build their scores from scratch by comparing titles from their own list two at a time, then writing the resulting scores back to AniList.

## Language

**Pool**:
The set of titles from one user's list (one media type, filtered by list status) that is being ranked.
_Avoid_: Queue, selection

**Rough Sort**:
The first pass over the Pool, where the user puts each title into a Band with a single tap, before any Duels.
_Avoid_: Pre-sort, quick sort, triage

**Rough Sort from Scores**:
An optional start where the app does the Rough Sort for the user, putting every title that already has an AniList score into a Band according to how far that score sits from the user's own average. Titles without a score still go through Rough Sort by hand. Duels follow as usual.
_Avoid_: Auto sort, skip, quick start

**Band**:
A coarse group a title is placed in during Rough Sort. There are always five Bands. Bands are fixed boundaries in the Ranking, so Duels only happen between titles in the same Band (or Sub-band), but a Band is not a score range.
_Avoid_: Bucket, tier, group

**Sub-band**:
One of the three ordered parts an oversized Band can be split into after Rough Sort. Like a Band, it is a fixed boundary for Duels, but it has no score range of its own and the Band stays one Band.
_Avoid_: Sub-tier, split, section

**Duel**:
One comparison between two titles in the Pool, where the user picks the better one, declares them equal, or marks one as Forgotten.
_Avoid_: Match, battle, comparison, pair

**Refine Duel**:
A Duel asked under the Scores Sort Goal because something moved a level boundary (a settings change, sync, Forgotten, Band move or Re-rank), to settle a title whose score is no longer certain. It is an ordinary Duel; the name only says why it is asked.
_Avoid_: Re-duel, extra Duel

**Settled**:
A title is settled when more Duels can no longer change its score under the current settings. Under Scores and Score New Titles, only settled titles can be ticked and imported.
_Avoid_: Final, locked, done

**Ranking**:
The ordered result of Rough Sort and all Duels so far: the five Bands in order, any Sub-bands in order inside a Band, Tiers in order inside each Band or Sub-band, and titles inside each Tier.
_Avoid_: Sort, order, list

**Duel log**:
The append-only record of every answer and change (Band choices, Duel answers, Forgotten, moves, Undo, sync). The Ranking is rebuilt by replaying it, and it is never rewritten.
_Avoid_: History, save, state

**Tier**:
A group of titles the user considers equal, all sharing one position in the Ranking and receiving the same score.
_Avoid_: Tie group, bucket

**Forgotten**:
A title the user can no longer remember well enough to judge, marked during Rough Sort or a Duel; it is removed from the Ranking and its existing AniList score is left untouched.
_Avoid_: Skipped, excluded

**Undo**:
Cancelling the user's most recent answer or change. It is recorded as an event in the Duel log, not by deleting anything, and it can't reach back past a sync.
_Avoid_: Revert, back

**Re-rank**:
Taking one title out of the Ranking and running Duels again to find its new place.
_Avoid_: Re-sort, re-duel

**Distribution**:
The rule that turns positions in the Ranking into scores between a user-chosen best and worst score: Linear or Bell.
_Avoid_: Curve, mapping

**Score Format**:
The AniList setting that decides which scale the user sees: 100 points, 10 points, 10 points with decimals, 5 stars, or 3 smileys. Scores are calculated at the levels of this scale.
_Avoid_: Scale, rating system

**Score Step**:
The smallest gap between the scores a title can get: every level of the Score Format (fine), every 0.5 on 10 points with decimals or every 5 on 100 points (human), or whole points, every 1 on 10 points with decimals or every 10 on 100 points (whole). The Full Ranking Sort Goal lets the user choose fine or human; the Scores Sort Goal always uses whole. Formats without decimals have only one step. Best and worst scores always sit on the Score Step.
_Avoid_: Precision, rounding, granularity

**Sort Goal**:
What the Duels aim for, chosen by the user. Scores stops once every title's score is settled, so titles with the same score have no order among themselves; Full Ranking keeps going until every title has its own place. The two share one Pool and the user can switch between them at any time without losing answers. Score New Titles scores only titles without a score, by Duels against Anchors, and can only be chosen when a Ranking starts.
_Avoid_: Mode, fast mode, quick mode

**Preview**:
The screen that shows every title's old and new score before an Import, where the user ticks which titles to write and fixes the Ranking.
_Avoid_: Review, summary

**Board**:
The screen that shows every title that has a Band, grouped into the five Bands, where the user can move any single title to another Band. It is open only before the first Duel: during Rough Sort, and once more as a last check after it. It shows Bands only, not the Ranking inside them.
_Avoid_: History, tier list

**Import**:
Writing the chosen new scores from the Ranking back to the user's AniList list.
_Avoid_: Export, sync, upload

**Backup**:
A file holding one Ranking's Duel log and settings, which the user can Restore in another browser.
_Avoid_: Export, progress file, save file

**Anchor**:
A title in the user's list, of any status, that already has an AniList score, used as a fixed reference point when scoring unscored titles. Its score is never changed.
_Avoid_: Reference, benchmark, scored title

**Suspect Anchor**:
An Anchor whose Duel results have contradicted its own score at least twice. It stops being used as a reference, and its score is still left untouched.
_Avoid_: Wrong anchor, outlier

**Catch-up**:
The screen where a user adds titles they have already seen to their AniList list, a batch of suggestions at a time, by marking each one Completed, Dropped or Planning.
_Avoid_: Onboarding, quick add, backfill, import

**Passed**:
A title shown in Catch-up that the user left unmarked. It isn't suggested again for 30 days.
_Avoid_: Skipped, dismissed, not seen

**Media Type**:
Anime or Manga. Each Pool, and so each Ranking, contains only one Media Type.
_Avoid_: Category, kind
