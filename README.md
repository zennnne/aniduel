# AniDuel!

Build your AniList scores by comparing titles from your own list two at a time, then write the new scores back to AniList.

**Live:** https://zennnne.github.io/aniduel/

## Three ways to use it

You pick a **Sort Goal** when a Ranking starts.

| Sort Goal | Pick it when | Duels stop when |
| --- | --- | --- |
| **Scores** | you just want new scores on AniList | every title's score is settled |
| **Full Ranking** | you also want an exact order of your titles | every title has its own place |
| [**Score New Titles**](#score-new-titles) | you like the scores you have and only want to score the titles that have none | every unscored title has a score |

Scores and Full Ranking rebuild every score from scratch and share the steps below. The default is Full Ranking for a Pool under 100 titles and Scores from 100 up, and you can switch between the two at any time without losing answers. Score New Titles works differently and is described in [its own section](#score-new-titles).

## How it works

1. **Log in** with AniList. Pick a Media Type (Anime or Manga), which list statuses go into the **Pool**, and a Sort Goal.
2. **Rough Sort** — put each title into one of five **Bands** with a single tap.
   - Or use **Rough Sort from Scores**: titles that already have an AniList score go into a Band by how far that score sits from your own average, and only unscored titles are sorted by hand.
   - Oversized Bands can be split into three **Sub-bands**.
3. **Board** — see every title grouped into its Band and drag any title to another Band. Open during Rough Sort and once more as a last check before the first Duel.
4. **Duel** — pick the better of two titles from the same Band, call them equal (they share a **Tier**), or mark one **Forgotten**. Every answer can be undone.
5. **Preview** — see every title's old and new score, move or **Re-rank** titles, and tick which ones to write. Three settings shape the scores:
   - the best and worst score
   - the **Distribution**: Linear or Bell
   - the **Score Step**: fine, or human steps like every 0.5 / every 5
6. **Import** — write the chosen scores back to your AniList list (throttled, resumable, retries on rate limits).

Progress is saved in your browser. Use **Backup** / **Restore** to move a Ranking to another browser. The Pool syncs with AniList when you come back, so added or removed titles are picked up.

See [GLOSSARY.md](GLOSSARY.md) for the exact meaning of each term.

### Scores or Full Ranking?

| | **Scores** (default from 100 titles) | **Full Ranking** (default under 100 titles) |
| --- | --- | --- |
| Duels stop when | every title's score is settled | every title has its own place |
| Titles with the same score | grouped, no order among them (sorted by name) | each in its own place, or a Tier if you called them equal |
| Score Step | whole points only (every 1 on 10 points with decimals, every 10 on 100 points) | fine (every level) or human (every 0.5 / every 5) |
| Duels needed | about 30–40% fewer than Full Ranking (200 titles, whole points) | about 1,000 for 200 titles |
| Changing best/worst or Distribution later | costs Refine Duels (roughly 50–120) before the affected titles can be imported | free: the order is already complete |

Under Scores, two more things differ:

- A change that moves a score boundary (settings, sync, Forgotten, a Band move, Re-rank) asks a few **Refine Duels** to settle the titles it affected.
- Preview groups titles by score level, and only settled titles can be ticked.

Switching keeps every answer. Switching to Full Ranking first shows about how many more Duels it will take.

### Score New Titles

For when you already have a scoring scale and don't want it changed. Titles that already have an AniList score are **Anchors**: fixed reference points whose scores are never touched. Each title without a score is put through Duels against Anchors only, and gets the score of the Anchors it sits among.

**When you can use it**

- Offered on Start when your list has at least 20 Anchors on at least 3 different scores.
- It can only be chosen when a Ranking starts, and can't be switched with the other two Sort Goals.

**How it differs from the steps above**

- No Rough Sort, Board or Bands: Duels start straight away, always a new title against an Anchor.
- A score boundary is passed only when two different Anchors agree.
- A new title that beats every Anchor of one score and loses to every Anchor of the next gets a one-off **Closer-to prompt**: which of the two scores is it closer to.
- An Anchor whose Duel results contradict its own score twice becomes a **Suspect Anchor**. It stops being used as a reference and is listed on Preview.
- Preview opens as soon as one new title is settled, so you can import some scores without finishing the rest.
- The Ranking ends with its Import. Titles still without a score start fresh next time, against Anchors that now include the ones just imported.

### Catch-up

A thin AniList list leaves little to rank. **Catch-up** fills it in: it shows anime you have probably already watched and lets you add them to your list quickly. Anime only, opened from Start or the menu.

- **What it suggests:** 20 anime at a time, picked from the sequels, prequels and community recommendations of what is on your list, plus popular titles from the years and formats you watch.
- **What you do:** mark each one Completed, Dropped, Planning or Paused, then save to get the next batch. Saves are written to AniList in the background.
- **Titles you leave unmarked** are **Passed** and aren't suggested again for 30 days.
- **With a near-empty list**, Catch-up first asks roughly when you started watching anime.
- **When you are done**, it offers to go on to Score New Titles if you qualify, or to your default Sort Goal if not.

## Development

Requires Node 22+.

```sh
npm install
npm run dev        # http://localhost:5173/aniduel/
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm test` | Run tests once (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc -b` |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm run eval:catchup` | Holdout eval used to choose the Catch-up suggestion weights |

Login uses AniList's OAuth implicit grant. Two AniList API clients are registered in `src/config.ts`: one for production (`https://zennnne.github.io/aniduel/`) and one for local dev (`http://localhost:5173/aniduel/`). The redirect URL must match exactly, so run the dev server on port 5173.

## Project layout

```
src/
  anilist/      AniList GraphQL gateway and types
  auth/         OAuth token handling
  pool/         Building the Pool, picking Anchors, and syncing with AniList
  ranking/      Ranking engine (replays the Duel log), Sort Goal, scoring, Sub-band split,
                Rough Sort from Scores, Score New Titles, Refine Duel estimates, Preview
  catchup/      Catch-up suggestions, batches, Passed titles, starting era, exit offer
  import/       Import plan and state
  writes/       Write queue and rate limiter shared by Import (scores) and Catch-up (list statuses)
  persistence/  Saved progress and Backup files
  ui/           React screens (Start, Rough Sort, Board, Band choice, Duel, Split, Preview, Import, Catch-up)
scripts/        Catch-up holdout eval
docs/adr/       Architecture decision records
docs/research/  Research behind the Catch-up suggestions
```

Key design decisions:

- [ADR 0001](docs/adr/0001-duel-log-as-source-of-truth.md) — The Duel log is the source of truth; the Ranking is rebuilt by replaying it.
- [ADR 0002](docs/adr/0002-bands-order-only-with-band-score-ranges.md) — Bands decide order only; the Distribution decides scores.
- [ADR 0003](docs/adr/0003-calculate-scores-at-score-format-levels.md) — Scores are calculated at the user's Score Format levels.
- [ADR 0004](docs/adr/0004-no-router-on-github-pages.md) — No client-side router; screens are driven by app state.
- [ADR 0005](docs/adr/0005-duel-log-is-never-rewritten.md) — The Duel log is never rewritten.
- [ADR 0006](docs/adr/0006-split-oversized-bands-into-sub-bands.md) — Oversized Bands split into three Sub-bands.
- [ADR 0007](docs/adr/0007-sort-goal-scores-with-settings-in-the-duel-log.md) — Sort Goal: Scores or Full Ranking (the default follows the Pool size), with scoring settings in the Duel log.
- [ADR 0008](docs/adr/0008-rough-sort-from-scores-as-one-event.md) — Rough Sort from Scores is one event that carries every Band choice.
- [ADR 0009](docs/adr/0009-score-new-titles-against-anchors.md) — Score New Titles: a third Sort Goal that scores unscored titles against fixed Anchors.
- [ADR 0010](docs/adr/0010-score-new-titles-ends-with-its-import.md) — A Score New Titles Ranking ends with its Import.

## Deployment

Every push runs CI (lint, test, build). Pushes to `main` also deploy `dist/` to GitHub Pages.
