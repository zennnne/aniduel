# AniDuel!

Rebuild your AniList scores from scratch by comparing titles from your own list two at a time, then write the new scores back to AniList.

**Live:** https://zennnne.github.io/aniduel/

## How it works

1. **Log in** with AniList and pick a Media Type (Anime or Manga) and which list statuses go into the **Pool**.
2. **Rough Sort** — put each title into one of five **Bands** with a single tap. Oversized Bands can be split into three **Sub-bands**.
3. **Duel** — pick the better of two titles from the same Band, call them equal (they share a **Tier**), or mark one **Forgotten**. Every answer can be undone.
4. **Preview** — choose the best and worst score, the **Distribution** (Linear or Bell) and the **Score Step** (fine, or human steps like every 0.5 / every 5). See every title's old and new score, move or **Re-rank** titles, and tick which ones to write.
5. **Import** — write the chosen scores back to your AniList list (throttled, resumable, retries on rate limits).

Progress is saved in your browser. Use **Backup** / **Restore** to move a Ranking to another browser. The Pool syncs with AniList when you come back, so added or removed titles are picked up.

See [GLOSSARY.md](GLOSSARY.md) for the exact meaning of each term.

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

Login uses AniList's OAuth implicit grant. Two AniList API clients are registered in `src/config.ts`: one for production (`https://zennnne.github.io/aniduel/`) and one for local dev (`http://localhost:5173/aniduel/`). The redirect URL must match exactly, so run the dev server on port 5173.

## Project layout

```
src/
  anilist/      AniList GraphQL gateway and types
  auth/         OAuth token handling
  pool/         Building the Pool and syncing it with AniList
  ranking/      Ranking engine (replays the Duel log), scoring, Sub-band split, Preview
  import/       Import plan and runner (writes scores to AniList)
  persistence/  Saved progress and Backup files
  ui/           React screens (Start, Rough Sort, Band choice, Duel, Split, Preview, Import)
docs/adr/       Architecture decision records
```

Key design decisions:

- [ADR 0001](docs/adr/0001-duel-log-as-source-of-truth.md) — The Duel log is the source of truth; the Ranking is rebuilt by replaying it.
- [ADR 0002](docs/adr/0002-bands-order-only-with-band-score-ranges.md) — Bands decide order only; the Distribution decides scores.
- [ADR 0003](docs/adr/0003-calculate-scores-at-score-format-levels.md) — Scores are calculated at the user's Score Format levels.
- [ADR 0004](docs/adr/0004-no-router-on-github-pages.md) — No client-side router; screens are driven by app state.
- [ADR 0005](docs/adr/0005-duel-log-is-never-rewritten.md) — The Duel log is never rewritten.
- [ADR 0006](docs/adr/0006-split-oversized-bands-into-sub-bands.md) — Oversized Bands split into three Sub-bands.

## Deployment

Every push runs CI (lint, test, build). Pushes to `main` also deploy `dist/` to GitHub Pages.
