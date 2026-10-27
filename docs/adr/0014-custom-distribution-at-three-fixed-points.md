# Custom Distribution at three fixed points, not Band score ranges

Users asked to shape their scores themselves (#60): with most titles in the top two Bands, Linear and Bell give the bottom of 🙂 scores that feel too low, and best/worst can't move the middle. The request was a score range per Band, which ADR 0002 rejected. We add a third Distribution, **Custom**, shaped by three Quartile scores: the scores the user picks for the title a quarter, half and three quarters of the way down the Ranking. Between best, the Quartile scores and worst, scores fall on straight lines. Scores still come from a title's position in the whole Ranking, never from its Band, so ADR 0002 stands.

## Rules

- **Never rising.** best ≥ 25% ≥ 50% ≥ 75% ≥ worst, every one on the Score Step. Neighbours may be equal, which gives a flat stretch where every title gets one score. Preview's selects don't offer a value that breaks the order. Because a score never rises down the Ranking, the Scores Sort Goal can still tell when a title is Settled (ADR 0007), so Custom works on both Full Ranking and Scores.
- **Starting values.** The first time the user picks Custom, the Quartile scores are the scores the Distribution they had (Linear or Bell) gives at those three points.
- **Kept when switching away.** The Quartile scores stay in the scoring settings while Linear or Bell is chosen, so picking Custom again brings them back.
- **Following other changes.** When best, worst or the Score Step change, or AniList reports a new Score Format (ADR 0003), each Quartile score is carried over the way best and worst are, then clamped to keep the order. They are never rescaled in proportion, because rounding to the Score Step would make the numbers the user picked drift on their own.
- **Every Score Format**, including 3 smileys, so there is no special case.
- The Quartile scores are part of the `scoring-set` event and the Backup like the other scoring settings (ADR 0007). Changing them can unsettle titles on Scores and start Refine Duels, like any other settings change.

## Considered Options

- **A score range per Band** (the request in #60): rejected again for ADR 0002's reason. The shape of the scores would follow the Band sizes, and a user with a large 😍 Band would get most of the list at the top.
- **One middle score only**: simplest, but in the case from #60 (206 titles, the bottom of 🙂 about two thirds of the way down) it can't lift that title to 7 without pulling the whole top half up with it.
- **Points the user adds and places**: the most flexible, but the controls, the checks on both axes and the saved shape all get heavier, for little gain over three fixed points.
- **Quartile scores on top of Bell**: rejected. Bell between user-chosen points is hard to define and hard to predict.
