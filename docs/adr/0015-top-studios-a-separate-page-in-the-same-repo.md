# Top Studios: a separate page in the same repo, scoring with v2.7 as is

Top Studios ranks one AniList user's animation studios from their list (#87). It came out of a research prototype in Python (`scripts/top-studio-score/prototype.py`, spec `docs/research/top-studio-score.md`), and it has little in common with AniDuel!'s Rankings: no Duel log, no Pool, nothing saved, and it can look up anyone's list, not only the logged-in user's. It should still feel like part of the same site and reuse what AniDuel! already has.

## Decision

**A second page in this repo.** Vite builds two HTML entries (`index.html` and `studios/index.html`), served at `/aniduel/` and `/aniduel/studios/` on the same GitHub Pages site. Still no router (ADR 0004): the page is a real path GitHub Pages serves as is, and the username to look up lives in the `user` query parameter, so `/aniduel/studios/?user=<name>` is the share link. The page has its own HTML head (title, description and Open Graph tags with full URLs, as for AniDuel!), so a shared link previews as Top Studios. The two pages link to each other: AniDuel!'s menu has Top Studios, and the studios page has "← AniDuel!".

The page shares the AniList gateway's `request` helper (so errors and headers behave the same) and the theme with AniDuel!, and draws the same mochi mascot. Being on the same origin, it reads the AniList token and the picked theme AniDuel! stores, sends the token only when it fetches (so a user's own private list loads), and never starts a login of its own; a token AniList refuses is dropped and the lookup goes on without it. Nothing is cached. `?fake-anilist` works on both pages under `npm run dev`, and the links between them keep it; the production build carries neither the fake nor the switch (`vite.config.test.ts`). The build splits the code both pages use into a shared chunk.

**The scoring is v2.7 as is.** `src/studios/scoring.ts` is a port of the prototype at v2.7 with its defaults only (α = 1, k = 13.1 at the user's average, γ = 0.1, love count per sequel/prequel franchise with the fav split, gate 6 → 5 → 4, label margin ±6 points against the top 20, watchlist of 5, main studios only). None of the formula was changed in the port, not even the open items listed in the research spec. The research switches (fav staff, `--prior=zero`, `--k=est`, …) were not ported. A parity script (`npm run parity:top-studios`, not part of `npm test`) runs both on the eight cached users: ranks and labels match exactly, S within 1e-6.

"As is" includes one quirk of the prototype: it computes a single vote's Z as ln(w·e^z / w) instead of z. The rounding decides whether an unscored drop (z exactly −1) counts as a flop (z ≤ −1), and it flips labels on 7 of the 8 users; the ±6-point margin was tuned on that output. The port keeps the same arithmetic for exact parity. The owner kept it as is for now; fixing it means changing both the prototype and the port and checking the labels again.

The Python prototype stays in the repo as the research reference. A change to the scoring is tried there first and measured with the favourite-studio check, then ported, and the parity script must pass again.

Update 2026-11-04: the first such change, v2.8 (a franchise factor on vote weight and length-weighted labels, research spec §13), went through this path. It was measured on a wider favourite check (§14), and parity passes on 33 cached users.

## Considered Options

- **A screen inside the AniDuel! app**: the app's screens follow from its state, and ADR 0004 says there are no deep links into them, so a shareable `?user=` result would be the one exception. The app is also built around a logged-in user's Ranking, while Top Studios needs no login and looks up anyone; every screen would have to tell the two apart.
- **A new site in its own repo**: a separate deploy and a different origin, so it couldn't read AniDuel!'s stored token or theme, and the AniList gateway and the theme would be copied rather than shared.
- **Changing the formula while porting** (the open items in the research spec: a scored-fraction gate in the formula, 1/m credit for multi-studio titles, smoothing the mid-score step, fixing the Z arithmetic above): each would change rankings or labels that the owner and the friends have only checked at v2.7, with no parity to test the port against. A low scored fraction is handled on the page instead, by the "How sure is this?" card. The options rejected during the research itself are listed in the research spec under "Decisions rejected".
