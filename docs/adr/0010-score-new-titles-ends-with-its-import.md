# A Score New Titles Ranking ends with its Import

Under Scores and Full Ranking a Ranking outlives its Import: the user can come back, fix it and import again. Score New Titles (ADR 0009) is different: once a new title's score is written it is an ordinary scored title, an Anchor for next time, and the user wants to import the settled titles without finishing the rest. So Preview can be opened as soon as one new title is Settled, and when the Import has written every score it planned with none failed, the whole Ranking is thrown away: the Duel log, the ticks, Forgotten marks and Suspect Anchors. Titles still without a score start fresh in the next Ranking, against Anchors that now include the titles just imported.

## Rules

- **Preview before the end.** During Duels and the Closer-to prompt a button opens Preview once at least one new title is Settled. Only Settled titles can be ticked, as before.
- **The Ranking ends when the Import finishes with no failed write**, whether every new title had a score or not. Skipped writes don't keep it.
- **A failed or cut-off Import keeps the Ranking** until Retry or Resume finishes it, so no settled score is lost before it is written.
- **No warning.** New titles are asked one at a time until Settled, so at most one title's Duels are lost, plus any Settled title the user chose not to tick.

## Considered Options

- **Keep the Ranking and carry on with the rest**: the imported titles would stay in it as new titles while already being scored on AniList, and they could never serve as Anchors for the rest, because the Anchors are one snapshot (ADR 0009).
- **Take only the imported titles out of the Ranking**: needs a new Duel log event and still leaves the old Anchor snapshot.
