# Sort Goal: Scores by default, with scoring settings in the Duel log

Most users want scores, not a full order, and a full sort of 200 titles costs about 1,000 Duels. We add a Sort Goal. **Scores**, the default, stops a title's Duels once its score level is settled, so titles on the same level have no order among themselves. **Full Ranking** is the current engine. Scores always uses the whole-point Score Step (1 on 10 points with decimals, 10 on 100 points). Full Ranking keeps the choice between fine and human. Each Duel now aims at a boundary between score levels, so which pair is prompted depends on the Score Format, the Score Step, best, worst and the Distribution. Replay checks every answer against the prompt (ADR 0005), so the Sort Goal and those settings become Duel log events.

## Rules

- **The default is Scores, and we don't ask.** Full Ranking can be picked from the menu or on Start. The user can switch either way at any time and keeps every answer. Switching to Full Ranking first shows about how many more Duels it will take.
- **Moving boundaries become Refine Duels.** Changing settings, a sync, Forgotten or a Band move can shift the level boundaries. Titles whose level is no longer settled go back into the Duel queue. On Preview those titles can't be ticked for Import until they are settled; the other titles can still be imported.
- **Ties work as before.** "About the same" puts both titles in one Tier with one score.
- **Preview and "Ranking so far"** show Scores as groups by level, sorted by name inside each group, so they don't suggest an order that was never asked.
- **Settings events and Undo.** Undo skips settings events: it neither cancels them nor gets blocked by them. Undo is for answers, so undoing a mis-tapped Duel must never also undo a best/worst change.
- **Older logs** replay as Full Ranking with their settings unchanged, and the user isn't told about Scores. The engine version is bumped (ADR 0005).
- **Sub-bands** (ADR 0006) are offered under the same rule in both Sort Goals. In the spike, splitting still saved about 10 percentage points in Scores.

## Considered Options

Spike: 200 titles, Linear 10..3, 20–40 runs each, with and without 30% ties. The Scores algorithm sorts a sample, takes pivots right at each predicted level boundary, sends each title to its group by a search weighted by group size, and reuses every order it already knows. "Savings" are fewer Duels than Full Ranking.

| Bands | step 0.5 | step 1 | Refine after a settings change |
|---|---|---|---|
| 150/12/12/13/13 | 17–21% | 27–30% | ~85–100 Duels |
| the same, 150 split into Sub-bands | 25–28% | 38–40% | ~95–105 Duels |
| 40 × 5 | 20–21% | 38–42% | ~95–120 Duels |

- **Scores with the 0.5 step**: rejected. We set a bar of 30% savings before adding a second engine path, and 0.5 stays at 17–28%. Fifteen levels are too fine to save much. The information-theoretic bound is about 49%, so a better algorithm might get there, but two spike rounds didn't.
- **Scores with fine steps**: 0.1 saves almost nothing, and random-pivot quickselect even costs more than Full Ranking.
- **Scores as the only goal, removing fine and human everywhere**: rejected. Full Ranking already orders every title, so fine and human cost no extra Duels there.
- **Keep the settings outside the log and stop checking the prompt on replay** (answers as free-standing `a > b` facts): rejected. This rewrites ADR 0001/0005 and loses the check that catches a corrupt log.
- **Lock the settings before the first Duel**: rejected. Beginners can't choose best/worst before they've seen a result, and the default needs to work with no setup.
- **Random-pivot quickselect** (the "score-level aware sorting" ADR 0006 rejected) saved only 1–18%, about what ADR 0006 measured. The low number came from the algorithm, not from the idea.

## Consequences

- A user on the Scores goal who later changes best/worst or the Distribution pays about 50–120 Refine Duels before those titles can be imported. Full Ranking never pays this.
- Without a Sub-band split, a lopsided Band only reaches 27–30%, right at the bar. The split offer matters more under Scores.

## Amendment (V3): the default depends on Pool size

The default is now **Full Ranking when the Pool has fewer than 100 titles**, and Scores from 100 up. Below 100 a full sort costs few enough Duels that the extra order is worth it. The default follows the Pool size on Start as the statuses change, until the user picks a Sort Goal themselves. A third Sort Goal, Score New Titles, is added in ADR 0009; it is never the default.
