# PROTOTYPE: how the Picker looks (#63)

Throwaway. This branch is never merged; main keeps only the decisions, written on #63 and #61.

- `picker.html`: the final design, one standalone file. Open it in a browser. The pink box switches the mocked states (nothing picked, from Catch-up, a mix, too few Anchors, 1000+ titles, no match, the unsettled question), the rail, phone width and dark.
- `picker.src.html`: its source. `node build.mjs` bakes `data.json` into it.
- `rounds/`: the source of each round as the user judged it, five variants per question. Build one with `node build.mjs rounds/<file>` and open the `.html` it writes.
  1. overall shape of the screen
  2. the title card, the filters, the summary and Confirm
  3. the card in detail, the closed rail, the dock
  4. genre and tag filters, picking many at once, the unsettled question
  5. the phone, nothing matching
- `data.json`: real titles, years, covers, genres and tags from AniList's public API (`fetch.mjs`, then `fetch2.mjs`). Scores and list statuses of the 1000+ list are made up, and the Duel estimate is a rough stand-in.
