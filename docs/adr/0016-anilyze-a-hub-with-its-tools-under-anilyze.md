# AniLyze: a hub page with its tools under /anilyze/

Top Studios (ADR 0015) is about to get a sibling, Top Directors, and more tools of the same kind may follow: each looks up one AniList user's list by name, needs no login and saves nothing. We gather them under **AniLyze**, a hub page on the same site. This replaces ADR 0015's URL for Top Studios; the rest of ADR 0015 stands.

## Decision

- **Paths.** The hub is `/aniduel/anilyze/`, and each tool is a page under it: `/aniduel/anilyze/studios/`, `/aniduel/anilyze/directors/`. Each is its own HTML entry with its own head (title, description, Open Graph), still with no router (ADR 0004), and the username stays in `?user=`.
- **The old path redirects, for good.** `/aniduel/studios/` stays as a page that only forwards to `/aniduel/anilyze/studios/`, keeping the whole query (`?user=` and, under `npm run dev`, `?fake-anilist`), by script with a `<meta refresh>` fallback. It keeps Top Studios' head, so a link shared before the move still previews as Top Studios.
- **The hub takes the username once.** It has one username field, filled with the logged-in AniDuel! user's name when a token is stored, and a card per tool that opens it with `?user=<name>`, so the result loads at once; with the field empty, a card opens the tool blank. Each tool links to the other tools with the same `?user=`. The hub fetches nothing itself, and only lists tools that exist (no "coming soon").
- **Links.** AniDuel!'s Start link and Ranking menu go to the hub, not to a tool. Each tool links back with "← AniLyze", and the hub with "← AniDuel!".

## Considered Options

- **Hub at `/aniduel/anilyze/`, tools left where they are** (`/aniduel/studios/`, `/aniduel/directors/`): no redirect and no moved links, but the URLs don't show the tools belong together.
- **One AniLyze page, `?tool=studios&user=…`**: one HTML entry, but every tool would share one head, so a shared link couldn't preview as the tool it opens (the reason ADR 0015 gave each page its own), and it needs a small router.
- **A temporary redirect**, dropped after a version or two: less to keep, but links already shared with friends would break, for the sake of one small HTML file.
- **Hub cards showing each tool's headline** (the #1 studio, the #1 director): the hub would have to fetch for every tool, slow under AniList's ~30 requests a minute.
