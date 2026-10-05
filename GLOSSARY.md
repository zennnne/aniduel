# AniDuel!

Helps AniList users build their scores from scratch by comparing titles from their own list two at a time, then writing the resulting scores back to AniList.

## Language

**Pool**:
The set of titles from one user's list (one media type, filtered by list status) that is being ranked.
_Avoid_: Queue, selection

**Rough Sort**:
The first pass over the Pool, where the user puts each title into a Band with a single tap, before any Duels.
_Avoid_: Pre-sort, quick sort, triage

**Band**:
A coarse group a title is placed in during Rough Sort. There are always five Bands. Bands are fixed boundaries in the Ranking, so Duels only happen between titles in the same Band, but a Band is not a score range.
_Avoid_: Bucket, tier, group

**Duel**:
One comparison between two titles in the Pool, where the user picks the better one, declares them equal, or marks one as Forgotten.
_Avoid_: Match, battle, comparison, pair

**Ranking**:
The ordered result of all Duels so far: an ordering of Tiers from best to worst.
_Avoid_: Sort, order, list

**Tier**:
A group of titles the user considers equal, all sharing one position in the Ranking and receiving the same score.
_Avoid_: Tie group, bucket

**Forgotten**:
A title the user can no longer remember well enough to judge; it is removed from the Ranking and its existing AniList score is left untouched.
_Avoid_: Skipped, excluded

**Re-rank**:
Taking one title out of the Ranking and running Duels again to find its new place.
_Avoid_: Re-sort, re-duel

**Distribution**:
The rule that turns positions in the Ranking into scores between a user-chosen best and worst score: Linear or Bell.
_Avoid_: Curve, mapping

**Score Format**:
The AniList setting that decides which scale the user sees: 100 points, 10 points, 10 points with decimals, 5 stars, or 3 smileys. Scores are calculated at the levels of this scale.
_Avoid_: Scale, rating system

**Import**:
Writing the chosen new scores from the Ranking back to the user's AniList list.
_Avoid_: Export, sync, upload

**Media Type**:
Anime or Manga. Each Pool, and so each Ranking, contains only one Media Type.
_Avoid_: Category, kind
