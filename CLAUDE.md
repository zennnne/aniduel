# AniDuel!

## Checking UI

To see a screen without an AniList login, run `npm run dev` and open `http://localhost:5173/aniduel/?fake-anilist`: Start, signed in against a fake AniList with a fixed list (`src/dev/fakeSession.ts`). Every page load starts fresh. The fake has no Catch-up suggestions (the screen shows its error), and Manga shows the same titles as Anime.

AniLyze works the same way: `http://localhost:5173/aniduel/anilyze/?fake-anilist` opens the hub logged in as the fake's user, `Fake Zen`, with that name filled in, and its cards keep `?fake-anilist`. Top Studios is at `http://localhost:5173/aniduel/anilyze/studios/?fake-anilist`, logged in the same way with that name filled in; add `&user=Fake%20Zen` to load the result at once. The old path `/aniduel/studios/` forwards there with the query kept. The fixed list ranks seven studios with all four labels on a lowered gate (4) and fills the watchlist. Any other name is "no such user".

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (via `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
