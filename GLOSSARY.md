# AniDuel!

Helps AniList users build their scores from scratch by comparing titles from their own list two at a time, then writing the resulting scores back to AniList.

## Language

**Pool**:
The set of titles from one user's list (one media type) that is being ranked: every title of the chosen list statuses, or under Keep My Scale the titles the user picked by hand.
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
A title is settled when more Duels can no longer change its score under the current settings. Under Scores and Keep My Scale, only settled titles can be ticked and imported.
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
A title the user can no longer remember well enough to judge, marked during Rough Sort or a Duel; it is removed from the Ranking and its existing AniList score is left untouched. An Anchor marked Forgotten just stops being used as a reference; another Anchor is chosen instead.
_Avoid_: Skipped, excluded

**Undo**:
Cancelling the user's most recent answer or change. It is recorded as an event in the Duel log, not by deleting anything, and it can't reach back past a sync or the start of a Keep My Scale Ranking.
_Avoid_: Revert, back

**Re-rank**:
Taking one title out of the Ranking and running Duels again to find its new place.
_Avoid_: Re-sort, re-duel

**Distribution**:
The rule that turns positions in the Ranking into scores between a user-chosen best and worst score: Linear, Bell or Custom. Custom is shaped by the user's own scores at three fixed points of the Ranking, a quarter, half and three quarters of the way down.
_Avoid_: Curve, mapping

**Quartile score**:
The score the user chooses, under the Custom Distribution, for the title a quarter, half or three quarters of the way down the Ranking. Like best and worst, it sits on the Score Step, and it is never above the one before it.
_Avoid_: Anchor, checkpoint, mark, waypoint

**Score Format**:
The AniList setting that decides which scale the user sees: 100 points, 10 points, 10 points with decimals, 5 stars, or 3 smileys. Scores are calculated at the levels of this scale.
_Avoid_: Scale, rating system

**Score Step**:
The smallest gap between the scores a title can get: every level of the Score Format (fine), every 0.5 on 10 points with decimals or every 5 on 100 points (human), or whole points, every 1 on 10 points with decimals or every 10 on 100 points (whole). The Full Ranking Sort Goal lets the user choose fine or human; the Scores Sort Goal always uses whole. Formats without decimals have only one step. Best and worst scores always sit on the Score Step.
_Avoid_: Precision, rounding, granularity

**Sort Goal**:
What the Duels aim for, chosen by the user. Scores stops once every title's score is settled, so titles with the same score have no order among themselves; Full Ranking keeps going until every title has its own place. The two share one Pool and the user can switch between them at any time without losing answers. Keep My Scale scores only the titles the user picks by hand, whether or not they already have a score, by Duels against Anchors, so every other score stays as it is. It can only be chosen when a Ranking starts, and its Pool can't be added to afterwards. Its Ranking ends with its Import: once the Import has written every chosen score, nothing of that Ranking is kept except the list of titles that were not yet Settled, which the user is offered to pick again next time.
_Avoid_: Mode, fast mode, quick mode, Score New Titles (the old name of Keep My Scale)

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
A title in the user's list, of any status, that already has an AniList score and is not itself being scored in this Ranking, used as a fixed reference point for the titles that are. Its score is never changed.
_Avoid_: Reference, benchmark, scored title

**Picker**:
The screen where the user picks by hand the titles a Keep My Scale Ranking will score, from every title on their list except Planning ones, before that Ranking starts.
_Avoid_: Selection, chooser, title list

**Suspect Anchor**:
An Anchor whose own score was contradicted by at least two of the titles settled against it, and by more of them than not. It stops being used as a reference, and its score is still left untouched.
_Avoid_: Wrong anchor, outlier

**Closer-to prompt**:
The one-off question asked when the Duels leave a title being scored under Keep My Scale between two scores without settling it on either: which of the two scores is it closer to. Its answer settles the title.
_Avoid_: Tie-break, rounding question

**Deciding Duel**:
A Duel asked under Keep My Scale when a title is left between two scores, against one more Anchor of one of them, to settle the title without the Closer-to prompt. It is an ordinary Duel; the name only says why it is asked.
_Avoid_: Extra Duel, tie-break Duel, split Duel

**Catch-up**:
The screen where a user adds titles of one Media Type to their AniList list, a batch of suggestions at a time, by marking each one Completed, Dropped, Planning or Paused, or, for Manga, Reading. Most are titles they have already watched or read; one they haven't but want to is marked Planning. A Manga title the user has caught up with but that hasn't finished is marked Reading.
_Avoid_: Onboarding, quick add, backfill, import

**Passed**:
A title shown in Catch-up that the user left unmarked. It isn't suggested again for 30 days.
_Avoid_: Skipped, dismissed, not seen

**Watched**:
A title on the user's list with any status except Planning, however it was scored. For Manga it means read: the one word covers both Media Types. Catch-up suggests from watched titles of its Media Type and counts them for the near-empty list.
_Avoid_: Seen, finished, read (as a separate term)

**Starting era**:
Roughly when the user started watching anime, or reading manga, asked by Catch-up only while their list of that Media Type is near empty. Each Media Type has its own. It picks the popular titles in the first batches, is stored locally per user, and can be changed until the list grows past the threshold.
_Avoid_: Era answer, start year, age

**Media Type**:
Anime or Manga. Each Pool, and so each Ranking, contains only one Media Type.
_Avoid_: Category, kind

## Top Studios

**Top Studios**:
A page of its own on the AniDuel! site that ranks one AniList user's animation studios by how much that user liked their titles, read from the user's scores, drops, rewatches and favourite anime. It needs no login, and any username can be looked up. Only a title's main studios count, each in full.
_Avoid_: Favourite studios (AniList's own list, filled in by hand), studio ranking, studio stats

**Vote**:
One Watched title on the user's list, as it counts for each of its main studios: how far it sits from the user's own average, and a weight from its length, rewatches and, for a drop or an unfinished title, how much of it was watched. A favourite counts a little higher. An unscored title casts a Vote only if it was dropped (against the studio, at half weight), rewatched (for it) or is a favourite. Every title of a Franchise weighs a little less the longer the Franchise is, all by the same amount whatever their order; each still counts as one Vote toward the Gate.
_Avoid_: Entry, title score, rating

**Franchise**:
A studio's titles on the user's list joined by sequel or prequel, counted per studio. A spin-off or a new story in the same universe is part of it when the link says sequel.
_Avoid_: Series, chain, universe

**Studio Score**:
A studio's number on Top Studios: an average of its Votes that leans toward the best ones, pulled toward the user's own average until the studio has enough Votes, plus a small bonus for its Love count. 0 is an average studio for this user. The page shows it as 0–5 hearts against the user's #1.
_Avoid_: Studio rating, S (outside code and the research spec)

**Love count**:
How many works by a studio the user loved. A Franchise counts once, from its best title, unless two or more of its titles are favourites, which then count one each. It gives the Studio Score a small bonus for breadth.
_Avoid_: Hit count, favourites count

**Gate**:
The fewest Votes a studio needs to be ranked: 6, stepping down to 5 and then 4 while fewer than 10 studios would be ranked. The page says so when the Gate was lowered.
_Avoid_: Threshold, minimum, cutoff

**Label**:
What a ranked studio is like for this user, from its share of hits (Votes well above the user's average) and of flops (well below), each share weighed by how much was watched, so a long show counts for more than a short OVA, and compared with the same share across the user's top 20 studios: 💎 Elite (many hits, few flops), 🎲 Bold (many of both), 🛡️ Reliable (few of either), 💤 Meh (few hits, many flops). A share counts as many only 6 points above the top 20's.
_Avoid_: Badge, tag, category, type

**Watchlist**:
Up to 5 studios with a high Studio Score that don't reach the Gate, shown after the ranking, apart from it.
_Avoid_: Rising studios, honourable mentions, unranked
