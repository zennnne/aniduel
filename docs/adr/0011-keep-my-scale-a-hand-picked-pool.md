# Keep My Scale: Score New Titles renamed, with a Pool picked by hand

Score New Titles (ADR 0009) scored every title without a score. Users also want to score again a few titles whose old score they no longer trust, and to score only some of their unscored titles, without the rescale that Scores and Full Ranking bring. So the Sort Goal is renamed **Keep My Scale**, and its Pool is whatever the user ticks in the **Picker**: any title on their list except Planning ones, with or without a score. Everything else in ADR 0009 (Duels against Anchors, confirmation, Suspect Anchors, the snapshot) and ADR 0010 (the Ranking ends with its Import) stays, except where the rules below say otherwise.

## Rules

- **A picked title is never an Anchor**, even when it has a score. Anchors are the scored titles that were not picked; a picked title's old score plays no part in its Duels and is only shown in Preview as the old score.
- **Eligibility is checked twice.** Start offers the goal with at least 20 Anchors on at least 3 distinct scores, as before. The Picker counts the Anchors left after the picks and won't confirm below that, or with nothing picked.
- **The Picker replaces the status chips for this goal.** It lists every title except Planning ones, filtered by list status (Completed and Repeating at first), release year, genres and tags, with a search and a choice of sort order. "Add N without a score" adds every unscored title the filters show, whatever the search says. It opens with nothing ticked from Start, and with the unscored Completed and Repeating titles ticked from Catch-up's exit offer.
- **The Pool is fixed once the Ranking starts.** Nothing is added later, by hand or by sync; sync only takes out titles that left the list. Forgotten takes a title out as before.
- **Titles left unsettled are remembered.** When the Import ends the Ranking, the titles that were not yet Settled are kept as a list (no answers), per user and Media Type, in the browser only. Before the next Picker opens the user is asked whether to pick them again; saying no keeps the list, and it is asked again until the next Keep My Scale Ranking starts, which replaces it. A Ranking dropped without an Import leaves no such list.
- **The Sort Goal's value in the code is still `score-new-titles`.** No Duel log or Backup carries it: a log starts this goal with its `anchors-set` event and replay reports the value. So logs and Backups already written keep working with nothing to migrate (ADR 0005); only the name users see, the glossary and the code's own names change.

## Considered Options

- **Use the old score of a picked title as where its search starts**: fewer Duels, but the score the user distrusts would steer the result, and the engine would change.
- **Keep a picked scored title as an Anchor for the others**: a score that is about to change would be the measure for other titles.
- **Let the Pool grow after the start**: a scored title added later is already an Anchor in the snapshot and may have decided other titles.
- **Sync keeps adding unscored titles**: it would add titles the user chose not to pick, and there are no Pool statuses left to decide which.
- **Remember nothing after the Import** (ADR 0010 as it was): unscored titles come back with one button, but picked titles that have a score would have to be found and ticked again.

## Consequences

- A Suspect Anchor can now be fixed here: pick it in the next Ranking. ADR 0009 said this goal never rescores.
- Picking many scored titles can remove a whole Anchor score; the Picker has to show the Anchors left while the user ticks.
- ADR 0010's "nothing of that Ranking is kept" now has one exception, the list of unsettled titles.
