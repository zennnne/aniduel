# Keep My Scale: Deciding Duels before the Closer-to prompt, as the user's choice

ADR 0012 gives a title split on a score that score without asking. A title the Duels leave between two scores and split on neither is still asked the Closer-to prompt, and for a user who rarely answers "about the same" that is about half of all titles: on a list of 700 Anchors scored in half points, 49–55% in `npm run eval:keep-my-scale`. To such a user the prompt comes up too easily, after only two Anchors of each score have been met.

So a Keep My Scale Ranking can now ask more Duels first. Where the Closer-to prompt would be asked, the title meets up to four more Anchors of the two scores, and the first split settles it. We call these **Deciding Duels**. The user chooses in the Picker, once per Ranking, between this and the rule of ADR 0012, because the two trade Duels for prompts and neither is better for every user.

## Rules

- **Only where the Closer-to prompt would be asked.** A title the Duels put strictly between two scores, split on neither, that has not answered the prompt. A title past the top or bottom Anchor score is not asked any, and neither is one split on both scores.
- **Up to four for a title, then the Closer-to prompt.** The count is not the user's to set. A title that is Re-ranked starts again with four.
- **The two scores take turns.** The next Deciding Duel is against an Anchor of the score the title has answered least (the upper one on a draw), the first one it hasn't met, starting where that score's Anchors start for this title (ADR 0009). Once it has met every Anchor of both scores, the Closer-to prompt is asked.
- **The first split settles the title**, on the score it is split on, with contradictions counted as ADR 0012 counts them.
- **"About the same" counts towards a split.** Under this rule a title is split on a score when its Anchors did not all give the same answer: a win and a loss, or "about the same" beside either. This holds for every split, past the top or bottom score too.
- **Every boundary is confirmed as before.** A Deciding Duel decides no boundary and moves no title to another pair of scores; it only chooses between the two scores the confirmed boundaries left.
- **The user chooses in the Picker.** A two-way control in the dock, beside the Duel estimate, under "When a title lands between two scores": "Ask me" (ADR 0012 as it is) and "More Duels first" (this rule). The estimate adds one Duel per title under "More Duels first".
- **One of the two is recommended for the list.** "More Duels first" when the Anchors left after the picks average at least 20 per Anchor score, "Ask me" below that. The control follows the recommendation until the user touches it.
- **The user's own choice is remembered.** A choice the user made by touching the control is stored in the browser when Duels start, per user, for Anime and Manga alike, and next time it is preselected over the recommendation, which is still marked. It is not part of a Backup.
- **Fixed for the Ranking, and named in the Anchor snapshot.** `anchors-set` carries `split: 'deciding-duels'`, and the engine version is bumped to 11. A Ranking can't change rule once started, and every older snapshot replays under the rule it names (ADR 0005).

## Considered Options

- **Ask until the title is split, with no limit.** A title that really sits in the middle of two scores beats every Anchor of the lower one and loses to every Anchor of the upper one, so it never splits: in a prototype one title took 61 to 110 Duels. Rejected.
- **A limit of two, or of eight.** On the 700-Anchor list, prompts for a user who never ties fell from about 50% to about 30% with two, to about 18% with four and to about 12% with eight, at about 3.5 Duels for every prompt avoided. Eight asked again 14–17% of the titles it had settled. Four is where most of the gain is.
- **Make it the rule for everyone.** It costs a user who never ties one to two more Duels per title, and one who answers the prompt easily gains nothing for them. Rejected for a choice.
- **Let the user set the limit.** A number with no meaning to someone who hasn't read this. Rejected.
- **Let the user switch during a Ranking.** Titles already settled would have to be judged again under the other rule, and the log would need an event for it. Not in this version.
- **Leave "about the same" out of a split.** For a user who ties within a quarter point, 34% of titles were still asked on a list of 100 Anchors, against 11% with it counted, for more Duels. Rejected.
- **Put the control in the Picker's filters.** It is not a filter, and the filters are closed on a phone. Rejected for the dock, where the Duel estimate it changes is shown.

## Consequences

All from `npm run eval:keep-my-scale -- --rule deciding-duels` against `--rule on-the-score` (Anchors worth their score give or take half a point, 5% of them off by two; the Closer-to answer is always the nearer score).

- A user who never ties, 700 Anchors on half points: Closer-to prompts fall from 49–55% of titles to 16–20%, for 9.8–10.0 Duels per title against 8.7–8.8. On 100 Anchors on whole scores: from 57–67% to 27–42%, for 8.2–8.7 Duels against 6.4–6.5.
- A user who ties within a quarter point: from 41–45% to 9–12% on whole scores for about half a Duel more, and from 23–26% to about 8% on half points for a tenth of a Duel more.
- No title takes more than four Duels over what it could before: 15 at most in the eval, against 14.
- Titles end a little further from their worth, 0.01–0.03 points on average, because the simulated user always answers the Closer-to prompt right and a split is noisier than that. Titles a whole point or more off don't change.
- A settled title is asked again more often, when an Anchor its split rested on becomes Suspect (ADR 0012). For a user who never ties, picking 20 titles: 8–19% of titles on lists under 20 Anchors per score, against 3–10%; 2–10% from 20 per score up, against 1–4%. Honest Anchors made Suspect stay at 0.4% or under from 20 per score up, and reach 6% below it. This is why the recommendation turns at 20.
- With two or three Anchors per score there is little left to ask: on 20 Anchors on half points prompts only fall from about 64% to about 54%.
- Placements, Suspect Anchors and Duel counts under "Ask me" are exactly those of engine 10.
- The older rules stay in the engine for as long as their logs are accepted.
