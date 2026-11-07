# Top Director Score

How Top Directors (spec #98, ticket #101) ranks an AniList user's **Directors**: Studio Score v2.8 (`top-studio-score.md`) with a title counting for each of its Directors instead of its main studios. Only the numbers the research sets apart change: the Gate (start, floor, how many must rank), `k`, and the Label base (top n, margin).

Status: measured on 2026-11-07 in the prototype (`scripts/top-studio-score/prototype.py --by=director`) on the 33 cached users. **The choice of Gate, k and Label base is pending the owner** (§5). Until then the prototype's Director defaults are option B, the recommendation. `GLOSSARY.md` gets the numbers once the owner picks.

## 1. What changes from Studio Score v2.8

- **Who a title counts for.** A credit whose role, before any parenthesis, is exactly `Director`, `Chief Director` or `Series Director` ("Director (eps 1-6)" counts; Episode, Assistant, Sound, Art, Animation directors don't). Every Director of a title gets its Vote in full; a person credited twice on one title counts once; a title with none counts for no one. Anime only.
- Everything else is v2.8 as is: z, w, one Vote per entry, the franchise factor n^−0.3 (Franchise = sequel/prequel chain *within that Director's titles*), the soft love count per Franchise with γ = 0.1, the prior at the user's average, length-weighted hit and flop rates. The `--staff` pseudo-vote is off and not used for Directors.
- Prototype: `--by=director` shares all the formula code; only the grouping key changes. Directors are keyed by name, or `name (id)` if two Directors on one list share a name. `--json` adds each Director's AniList `id` and an `every` list (id, S, Votes of every Director, ranked or not) for the favourite check. New flags for both modes: `--gate= --gate-floor= --gate-target= --label-top= --margin=`.
- **Studio output is unchanged**: `--json`, `--detail` and `--compact --top=20` are byte-identical before and after on all 33 users, the studio favourite check still reads 7.81 / 57 of 111 in the top 5, and `npm run parity:top-studios` passes.

Data on the 33 lists (19,738 counted entries): 6.1% of entries have no Director and count for no one; 11.5% have two or more.

## 2. Fetching the credits (for the port, #103)

- **Staff on the list query held**, on the largest list too (IustinMakihige, 6 chunks of 500 including Planning): `MediaListCollection(chunk, perChunk: 500) { … media { staff(sort: [RELEVANCE], perPage: 25) { edges { role node { id name { full } } } } } }`. About 4 s per chunk, no 500s. So Top Directors needs **no requests beyond the list chunks**. The paged `Page(perPage: 50) { media(id_in: …) { staff(…) } }` query also works, and the prototype keeps it only to fill in titles that left a list since it was cached (none did).
- **Sort by RELEVANCE and take the first page of 25.** `perPage` tops out at 25 and a title has 100 to 1,000 staff credits, so paging every title's staff would cost hundreds of requests on a big list. On a 150-title sample of the owner's list, paged to the end:
  - default sort: 42 of 150 titles had a Director past credit 25 (FMA: Brotherhood's at #26), so the first page isn't enough;
  - `ROLE` sort: 110 of 150, worse;
  - **`RELEVANCE`: every title's Director in the first 25.** Only 4 titles had Director-rule credits past 25: OP/ED directors ("Director (OP)", "Director (ED4, ED6)") and two part-season chief directors of Monogatari Second Season ("Chief Director (eps 7-10)", "(eps 17-26)"). The list query returns the same order as the paged query (146 of 150 titles give the same Directors as the full paging; the 4 others are those).
- The prototype caches only credits whose role contains "irector", as `directors_<user>.json` (gitignored like the other caches): `{mediaId: [[staff id, name, role], …]}`.

## 3. The favourite check for Directors

Same idea as Top Studios §14: favourites are never an input, so they are held-out answers. Each cached user's AniList favourite staff (already in `favs_<user>.json`) counts if that person is a Director of at least one counted title. `python -I favcheck.py --by=director [--verbose]`.

**How thin it is.** 588 favourite staff across the 33 lists, mostly voice actors; **110 direct a counted title, from 21 users**, but only **44 different people**, led by Naoko Yamada (13 users), Keiichirou Saitou, Akiyuki Shinbou and Kunihiko Ikuhara (7 each), Hiroyuki Imaishi, Masaaki Yuasa and Hideaki Anno (6 each). **32 of the 110 have 1–2 Votes and 8 have 3**: they are below any sensible Gate, so they can only show up as "not ranked". The owner has 16 of the 110, most at 1–2 Votes (Frieren's Saitou, JJK's Goshozono, Furukawa, …). So it is about as many labels as the studio check (111), but less independent, and it can say little about the Gate.

**Two measures.**
- *Rank*: rank in the user's ranking, last + 1 if not ranked; reported as mean rank, mean percentile (rank / (ranked + 1)), how many are ranked, in the top 5 and in the top 10. Mean rank can't be compared across Gates (a lower Gate ranks more Directors, so "last + 1" grows); top 5 and top 10 can.
- *Matched*: the vote-count bias that stops the studio check from tuning k (favourites have more Votes) is taken out by comparing each favourite only with the same user's non-favourite Directors with the same number of Votes ±1, ranked or not, and counting how often the favourite scores higher (0.5 = no signal). This was open item 10 in the studio spec.

**Result.** The matched win rate is **0.90 over 9,493 pairs** at every candidate: a Director the user favourited scores above a non-favourite with the same evidence 9 times in 10. So the formula carries over to Directors. But it is **flat in k** (0.900–0.901 for k = 3 to 20) and doesn't depend on the Gate or the labels, so it can't choose them either. The top-5 count moves by ±3 of 110 between candidates, which is noise. **The check can't pick the numbers; they come from the scale argument below and the owner's eye.**

## 4. Measurements

**Directors have about half a studio's Votes.** Over all 33 lists the median Votes per Director is 1 (studios 2), p90 4 (11), p99 10 (35), max 34 (92). Taking each user's 10th and 20th most-voted studio and Director, the median Director/studio ratio is **0.50 at the 10th** and 0.63 at the 20th (0.4 on the biggest lists: the owner's 10th studio has 22 Votes, the 10th Director 7). With the studio Gate of 6, only 16 of 32 rankable users get 10 Directors at 6, 12 fall to the floor of 4, and the smallest ranking has 3 Directors.

Candidates (32 rankable users; NutsuruSama has 5 scored titles). Label counts are over every user's top 10; studios at v2.8 had 💎 117 / 🎲 11 / 🛡️ 144 / 💤 38 of 330 (35% / 3% / 44% / 12%).

| candidate | Gate (users at each step) | median / min ranked | fav top 5 / top 10 (of 110) | favs ranked | matched | top-10 labels 💎/🎲/🛡️/💤 |
|---|---|---|---|---|---|---|
| A: studio numbers, Gate 6→4, k 13.1, top 20, ±6 | 6:16 5:4 4:12 | 13 / 3 | 46 / 64 | 59 | 0.901 | 110/14/129/29 |
| Gate 5→3, k 13.1 | 5:20 4:4 3:8 | 19 / 7 | 48 / 58 | 68 | 0.901 | 130/17/137/30 |
| Gate 4→2, k 13.1 | 4:24 3:6 2:2 | 27 / 10 | 48 / 63 | 74 | 0.901 | 149/18/128/25 |
| Gate 4→2, k 3 | same | 27 / 10 | 45 / 61 | 74 | 0.900 | 149/19/126/26 |
| Gate 4→2, k 6 | same | 27 / 10 | 46 / 61 | 74 | 0.901 | 150/19/125/26 |
| Gate 4→2, k 20 | same | 27 / 10 | 48 / 64 | 74 | 0.901 | 148/18/128/26 |
| Gate 4 fixed, k 6 | 4:32 | 27 / 3 | 44 / 66 | 70 | 0.901 | 127/16/112/27 |
| Gate 4→3, k 6, ±6 | 4:24 3:8 | 27 / 7 | 46 / 61 | 74 | 0.901 | 145/19/122/28 |
| **B: Gate 4→3, k 6, top 20, ±10** | 4:24 3:8 | 27 / 7 | 46 / 61 | 74 | 0.901 | 131/16/147/20 |
| Gate 3→2, k 4, ±6 | 3:30 2:2 | 56.5 / 10 | 41 / 59 | 78 | 0.901 | 149/26/127/18 |
| C: Gate 3→2, k 4, top 20, ±10 | 3:30 2:2 | 56.5 / 10 | 41 / 59 | 78 | 0.901 | 137/18/151/14 |

**Gate.** A floor of 2 only matters for Keennaja and phlox (20 and 22 Directors ranked at 2, against 7 each at a floor of 3); ranking someone on 2 titles is close to ranking a single title. At a start of 3, Directors with 3 Votes reach the owner's top 10 (Makoto Katou #7) and the top-5 count drops 46 → 41.

**k.** It doesn't move the check (above) and barely moves the owner's order: k 3 to 13.1 at Gate 4 changes the owner's top 10 only by neighbour swaps (Shinbou #2 at k 13.1, #3 at 6, #5 at 3; Miyamoto and Amemiya #4–5 at 6–13.1, #3–4 at 3). Scaled the way the Gate is, by the 0.5 vote ratio, studios' 13.1 becomes **6.5**, rounded to 6 (scaling by the Gate instead, 13.1 × 4/6, gives 8.7; the check can't tell them apart).

**Label base and margin.** With ±6, Directors get more 💎 than studios (47% of top-10 labels at Gate 4 vs 35%), because a Director with 4–6 Votes reaches a high hit share with one or two hits. Top 10 as the base swings the other way (105/17/168/30 at ±6: 33% 💎, 53% 🛡️), and top 30 is more 💎 again (170/20/111/19). A wider margin of **±10 on the top 20** gives 41% / 5% / 46% / 6%, the nearest to the studio mix. On the owner it moves Hideaki Anno and Atsuko Ishizuka 💎 → 🛡️ and Tatsuya Ishihara 💤 → 🛡️ (14% hits, 13% flops on 17 Votes).

## 5. Options (pending owner)

| | Gate | k | Label base | for | against |
|---|---|---|---|---|---|
| **A: studio numbers** | 6, stepping to 5 then 4, until 10 rank | 13.1 | top 20, ±6 | One set of numbers for both tools; nothing new to learn. | Directors have half the Votes: half the users drop to Gate 4, the median ranking is 13 and the smallest 3; the owner's 4-Vote Directors (Miyamoto, Amemiya, Miyazaki, Ishizuka) are only on the Watchlist. Labels lean 💎 a little. |
| **B: scaled to Directors (recommended)** | 4, stepping to 3, until 10 rank | 6 | top 20, ±10 | Scaled by the measured vote ratio (≈ 0.5); a median of 27 ranked, at least 7; no one ranks on 2 titles; label mix closest to studios'. | Two more numbers to keep apart from studios; ±10 differs from studios' ±6 (the rule in words stays "the same, a wider margin"). A 4-title Director can sit above a 24-title one (Miyamoto vs Shinbou is close either way). |
| **C: show more names** | 3, stepping to 2, until 10 rank | 4 | top 20, ±10 | The longest rankings (median 56); every favourite with 3+ Votes ranks. | 3-Vote Directors reach the top 10 (owner: Makoto Katou #7); the favourite top-5 count drops 46 → 41; two users rank Directors on 2 titles. |

Variants inside B, if the owner wants: ±6 instead of ±10 (one label rule for both tools, more 💎: owner's Anno and Ishizuka 💎, Ishihara 💤), or k 13.1 instead of 6 (Shinbou #2 over Ikuhara). The favourite check is the same for all of them.

**Owner's top 15 (zennnne), for the eye check** (Votes in brackets):

- **A** (Gate 6): 1. Naoko Yamada 💎 +0.68 (10), 2. Akiyuki Shinbou 🛡️ +0.62 (24), 3. Kunihiko Ikuhara 🛡️ +0.58 (6), 4. Tatsuya Ishihara 🛡️ +0.44 (17), 5. Hideaki Anno 💎 +0.43 (6), 6. Hiroyuki Imaishi 💎 +0.39 (7), 7. Hiroaki Akagi 💤 +0.35 (6), 8. Yasuhiro Takemoto 🛡️ +0.33 (6), 9. Tomoyuki Itamura 🛡️ +0.33 (10), 10. Shinichi Omata 🛡️ +0.30 (6), 11. Ei Aoki 💤 +0.29 (6), 12. Kazuya Tsurumaki 🎲 +0.28 (7), 13. Masaaki Yuasa 💤 +0.15 (7), 14. Noriaki Akitaya 🛡️ +0.14 (6), 15. Makoto Shinkai 🛡️ +0.11 (6)
- **B** (Gate 4): 1. Naoko Yamada 💎 +0.83 (10), 2. Kunihiko Ikuhara 🛡️ +0.76 (6), 3. Akiyuki Shinbou 🛡️ +0.72 (24), 4. Yukihiro Miyamoto 💎 +0.69 (4), 5. Akira Amemiya 💎 +0.68 (4), 6. Hideaki Anno 🛡️ +0.58 (6), 7. Tatsuya Ishihara 🛡️ +0.51 (17), 8. Hiroyuki Imaishi 🛡️ +0.51 (7), 9. Hayao Miyazaki 🛡️ +0.50 (4), 10. Hiroaki Akagi 💤 +0.48 (6), 11. Yuzuru Tachikawa 🛡️ +0.44 (5), 12. Yasuhiro Takemoto 🛡️ +0.44 (6), 13. Tomoyuki Itamura 🛡️ +0.43 (10), 14. Atsuko Ishizuka 🛡️ +0.42 (4), 15. Shinichi Omata 🛡️ +0.41 (6)
- **C** (Gate 3): 1. Naoko Yamada 💎 +0.90 (10), 2. Kunihiko Ikuhara 🛡️ +0.84 (6), 3. Yukihiro Miyamoto 💎 +0.80 (4), 4. Akira Amemiya 💎 +0.79 (4), 5. Akiyuki Shinbou 🛡️ +0.76 (24), 6. Hideaki Anno 🛡️ +0.65 (6), 7. Makoto Katou 💎 +0.63 (3), 8. Hayao Miyazaki 🛡️ +0.58 (4), 9. Hiroyuki Imaishi 🛡️ +0.57 (7), 10. Tatsuya Ishihara 🛡️ +0.54 (17), 11. Hiroaki Akagi 💤 +0.54 (6), 12. Yuzuru Tachikawa 🛡️ +0.51 (5), 13. Atsuko Ishizuka 🛡️ +0.49 (4), 14. Yasuhiro Takemoto 🛡️ +0.49 (6), 15. Tomoyuki Itamura 🛡️ +0.48 (10)

The owner's favourite Directors who rank: Yamada #1 everywhere; Ikuhara #2–3; Shinbou #2–5; Anno #5–6; Imaishi #6–9; Akira Amemiya (Gridman, 4 Votes) only from Gate 4.

**Decision: pending owner.** Record here which option (or variant) was picked and why, then add the numbers to the Gate and Label entries in `GLOSSARY.md` and set `MODE["director"]` in the prototype to match.

## 6. Open

1. **OP/ED directors match the rule.** "Director (OP)", "Director (ED1-ED3, ED5, ED7)" pass "the text before any parenthesis is exactly Director". On the first page of 25 they are rare: 69 of 16,204 Director credits across the 33 lists (0.4%), and no title has *only* OP/ED Directors, so they add a Vote for an opening's director to a title rather than take one away. A stricter rule (drop a parenthesis that names OP or ED) is easy if the owner wants it; not applied, because the ticket's rule is the spec.
2. **First page only.** Directors credited only past credit 25 under RELEVANCE are lost: on the sample, OP/ED directors and two part-season chief directors of a 26-episode Monogatari season. The port must use the same query (RELEVANCE, first 25) for parity.
3. Small co-directors ride on their lead's titles: Madoka's Series Director Yukihiro Miyamoto (4 Votes, all shared with Shinbou) ranks #4 under B. That is the "co-directors count in full" rule working as asked.
4. The favourite check can't tune Gate, k or labels for Directors either (§3). A Director-specific held-out signal would need more users who favourite Directors.
