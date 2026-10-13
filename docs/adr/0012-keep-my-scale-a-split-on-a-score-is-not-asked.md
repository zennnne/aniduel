# Keep My Scale: a title split on a score gets that score instead of the Closer-to prompt

_Amended by [ADR 0013](0013-keep-my-scale-deciding-duels-before-the-closer-to-prompt.md): under "More Duels first", which the user can choose per Ranking, a title split on neither score meets up to four more Anchors of the two scores before the Closer-to prompt, and "about the same" beside a win or a loss counts as a split too. "Ask me" is this ADR as it is._

ADR 0009 confirms every boundary between scores with two Anchors, and when two Anchors of one score disagree a third decides. A win and a loss against two Anchors of the same score count as such a disagreement, so the third Anchor moves the title off that score, into the gap above or below it, and the Closer-to prompt followed. A user who never answers "about the same" could therefore never land on an Anchor's score through Duels: every title ended in the Closer-to prompt unless it beat or lost to every Anchor, even one that beat every Anchor of the score below, lost to every Anchor of the score above, and both beat and lost to the Anchors of the score between.

So a title that the Duels leave between two scores, and that both beat and lost to Anchors of **one** of them, now gets that score without being asked. We call such a title **split** on the score.

## Rules

- **The third Anchor still decides.** A win and a loss against two Anchors of a score are confirmed by a third, as before: one drifted Anchor never places a title by itself. A title that beat one of three Anchors of a score goes on to the scores below it; one that beat two of three goes on to the scores above.
- **Split on one of the two scores: that score.** Where the Closer-to prompt would be asked between two scores, a title split on exactly one of them is settled on it instead.
- **Split on the top or bottom Anchor score: that score.** A title the Duels leave above every Anchor, or below every one, that is split on the top (bottom) score gets it, not the score past it: it lost to an Anchor of the top score, so it is not above every Anchor.
- **A win and a loss on a score with two Anchors: one Anchor of each neighbouring score is asked.** There is no third Anchor on the score, so the neighbouring scores are asked, as before. An honest answer from them tells nothing here (losing to the score above, beating the score below), and before this rule every one of their Anchors was asked before the title moved on. Now one from each is enough: either casts the deciding vote, or the boundary goes the way of the first answer and the split settles the title on the score.
- **Split on both, or on neither: the Closer-to prompt.** A title that beat every Anchor of one score and lost to every Anchor of the next is still asked, and so is one split on both.
- **A Closer-to answer stands.** Once a title has answered the prompt it is at, the score it chose is kept, even if an Anchor becoming Suspect later leaves it split on the other score only.
- **Contradictions are counted as for a Closer-to answer.** The title is judged as if it had chosen that score: the Anchor on the losing side of the split (the one it lost to out of three, when it ended above the score) is contradicted, the other two are not.
- **Answers from Forgotten or Suspect Anchors don't count towards a split**, as they count nowhere else. A title whose split rested on an Anchor that later becomes Suspect is no longer split, and is asked the Closer-to prompt after all.
- **Suspect: contradicted by two titles, and by most of the titles settled against it.** ADR 0009 made an Anchor Suspect at two contradictions, however many titles agreed with it. A title split on a score contradicts the Anchor on the losing side every time, so in a long Ranking most honest Anchors got there: with 100 Anchors and 300 titles, about half of them, and each one took the split away from the titles that rested on it. Now the two must also be more than half of the settled titles that met the Anchor.
- **The rule is named in the Anchor snapshot.** A new Ranking's `anchors-set` event carries `split: 'on-the-score'`, and the engine version is bumped to 10. A snapshot without it replays under the old rule, so a Ranking started before engine 10 finishes as it was answered, even after later events stamp the newer version on its header (ADR 0005).

## Considered Options

- **Settle on the score at the first win and loss, with no third Anchor.** Built first. It saves about one Duel per title and removes more prompts (about 45–65% of titles still asked, in a simulated run), but one drifted Anchor then places a title by itself: a title one score below a too-low Anchor beats it, loses to an honest Anchor of that score, and is settled there without meeting the Anchors of its own score. With 5% of Anchors off by two points, titles a whole score or more off rose from about 2% to about 11%, and a split recorded no contradiction, so Suspect Anchors were no longer found. Rejected: every boundary must stay confirmed.
- **Count no contradiction for the Anchors of the split score.** Fewer honest Anchors become Suspect (about 4% to under 1% of them in the same run), but only about half as many drifted Anchors are found, and titles a score off roughly double. Rejected.
- **Only settle a 1–1 split on a score with two Anchors.** Removes the answer-order effect, but a title with a win, a loss and a win is still asked.
- **Change replay for every log.** Simpler, but a Ranking in progress would stop matching its own answers and fail to load.

## Consequences

- Fewer Closer-to prompts for users who rarely answer "about the same": in a simulated run where the user never does, about 70–85% of titles are still asked, against about 95% before. Most of those are titles that really sit between two scores. The number of Duels doesn't change.
- A title that would have chosen the other score at the prompt now gets the split one. In the same run, titles a whole score off rose from about 2% to about 3% (5% of Anchors off by two points); none were further off than before.
- Fewer Suspect Anchors, honest and drifted both. In `npm run eval:keep-my-scale` (Anchors worth their score give or take half a point, 5% of them off by two, 100 Anchors, 300 titles, a user who never ties): honest Anchors made Suspect fell from about 52% to about 3%, drifted ones found from about 95% to about 38%. Titles a whole point or more off stayed under 1%.
- A settled title can become unsettled again when an Anchor its split rested on becomes Suspect: about 3% of titles in that run, against about 29% under the count of two. A title split on the top or bottom score moves to the score past it instead.
- A title that took dozens of Duels after a win and a loss on a score with two Anchors (44 in the eval's worst case) now takes at most 9 there.
- The old rule stays in the engine for as long as engine 9 logs are accepted.
