# Onboarding: surfacing titles the user has probably already watched

Research for a proposed onboarding page. It shows about 20 anime at a time from AniList. The user marks each one Completed / Dropped / Planning or skips it, and repeats until satisfied. The goal is **recall**: help the user finish *logging what they have already seen*. It is **not** about what they should watch next.

Researched 2026-10-08. API facts marked **(verified)** were checked against the live `graphql.anilist.co` endpoint on that date.

---

## TL;DR

- **Rate limit: 30 requests/min right now (verified).** The docs say the normal limit is 90/min, but the API is in a "degraded state" limited to 30, and the live `X-RateLimit-Limit` header returns `30`. There is also an undocumented burst limiter. The app's Import Runner already spaces requests 2200 ms apart (`src/import/runner.ts`), so reuse that throttle.
- **Best signals, strongest first:**
  1. **Relations** to titles the user has watched (sequel/prequel/parent/side story). These are close to certain.
  2. **AniList `recommendations` edges** from the user's watched titles, weighted by recommendation `rating` and by how many of the user's titles point at the candidate.
  3. **Popularity within the user's own era** (start-year distribution and format mix of their list).
  4. Tag/genre similarity is weak for recall. Use it only as a tie-breaker or for diversity.
- **Weight seeds by "watched at all", not by score.** Implicit-feedback research separates *whether* a user touched an item from *how much they liked it*. For "have you seen it?", a Dropped title is as good a seed as a 10/10 one. Score can be a small confidence boost at most.
- **Use `watched = popularity − PLANNING`, not raw `popularity`** (verified: `popularity` is the sum of every status, Planning included). For airing or hyped titles, Planning can be most of the count.
- The candidate pool fits in about 5–12 requests for a 300-title list. One `Page(perPage: 50, id_in: [...])` request can return 50 media, each with 25 recommendations, relations and tags (verified, about 126 KB).

---

## 1. How existing products do it

| Product | Flow | What's shown | Popularity vs personalised |
| --- | --- | --- | --- |
| **Letterboxd** | The welcome page tells new users to go to **Popular** and click the "eye" on posters they've seen. Logging, liking and rating happen in one place. [letterboxd.com/welcome](https://letterboxd.com/welcome/) | Poster grid of the Popular page (dozens per page) | Popularity only. No personalised "have you seen" flow. |
| **Goodreads** | At launch (2011), new users were "asked to rate a series of popular books" and recommendations started after **20 ratings**. Genre picks happen at sign-up. [Library Journal](https://www.libraryjournal.com/story/goodreads-launches-book-recommendation-feature), [CS Monitor](https://www.csmonitor.com/Books/chapter-and-verse/2011/0919/Goodreads-wants-to-tell-you-what-to-read-next) | Popular books, filtered by chosen genres | Popularity plus genre filter |
| **Taste.io** | Pick favourite films/genres, then rate titles one by one. "Users are prompted to rate a film they have seen, or **skip the title if they haven't seen it**." Recommendations start after about 20 ratings. [WRDW 2023](https://www.wrdw.com/2023/08/14/what-tech-how-taste-app-can-help-you-find-movie-watch), [Laughing Squid](https://laughingsquid.com/taste-an-online-service-that-recommends-movies/) | One card at a time | Popular to start, then CF |
| **Criticker** | Starts with about 10 titles to rate, picked "at random, across old and new genres" (secondary source). Users say it takes hundreds of ratings before it's useful. [Lifehacker JP](https://www.lifehacker.jp/article/criticker/), [Tildes thread](https://tildes.net/~movies/170y/does_anyone_else_use_criticker_for_film_and_tv_recommendations) | Small batches | Random/diverse |
| **MovieLens** (research) | Historically required **15 ratings** before recommendations ([GroupLens blog](https://grouplens.org/blog/author/kluver/)). The item-picking strategy came from Rashid et al. 2002 (see §2). A later version lets users pick from **groups** of clustered movies: it took less than half the time of rating 15 items, and users were more satisfied ([Chang, Harper, Terveen, CSCW 2015](https://dx.doi.org/10.1145/2675133.2675210)). | Grids, then groups | Popularity × entropy, then clusters |
| **Netflix** | An optional "pick a few titles you like" step when a profile is created. If skipped, it shows "a diverse and popular set" ([ScienceABC](https://www.scienceabc.com/innovation/netflix-get-right-content-time), [Lighthouse Labs](https://crm-production.lighthouselabs.ca/blog/how-netflix-uses-data-to-optimize-their-product)). These are secondary sources; Netflix publishes no official spec. | Grid of about 3 rows | Popular/diverse seeds |
| **Spotify / Vevo** | Spotify asks new users to pick **≥5 artists** ([Spotify newsroom](https://newsroom.spotify.com/tag/taste-onboarding/)). Vevo's onboarding "will take into account each choice you make then **adjust the next set of recommendations in real-time**" ([TechCrunch 2016](https://techcrunch.com/2016/03/24/vevos-recommendations-get-more-personalized-thanks-to-integrations-with-spotify-twitter-and-youtube)). | Grid; picks reshape the grid | Popular first, then related expansion |
| **Trakt** | No popular-picker onboarding found. Back-catalogue logging happens through importers (IMDb and Letterboxd importers added Nov 2024, [AlternativeTo](https://alternativeto.net/news/2024/11/trakt-introduces-importer-for-imdb-and-letterboxd)) or by marking titles watched one at a time. | n/a | n/a |
| **Simkl, MyAnimeList, AniList, Anime-Planet** | No documented "rate many quickly" onboarding found. All three anime sites rely on list import (MAL XML) and per-title status buttons. | n/a | n/a |

**Takeaways for AniDuel**

- Batches of **15–20** are the norm (MovieLens 15, Goodreads/Taste about 20). A grid of about 20 covers matches that.
- Everyone **starts from popularity**, because popular items are the ones the user is most likely to *have an opinion on*. Personalisation layers on top after a few answers.
- The best flows are **adaptive**: answers in batch *k* reshape batch *k+1* (Vevo; MovieLens groups).
- AniDuel has an advantage none of these have: the user *already has a list*, so it can personalise from the very first batch.

## 2. Algorithms for P(user has seen X)

### 2.1 This is an implicit-feedback / one-class problem

- **Hu, Koren & Volinsky (ICDM 2008), "Collaborative Filtering for Implicit Feedback Datasets":** splits each observation into a binary **preference** (`p = 1` if the user interacted at all) and a **confidence** `c = 1 + αx` that grows with interaction strength. Unobserved items are *unknown*, not negative. ([lecture summary](https://dparra.sitios.ing.uc.cl/classes/recsys-2018-2/clase7_implicit-feedback.pdf)) For AniDuel, "on the list as Completed/Current/Paused/Dropped/Repeating" means `p = 1`. Score is at most a confidence modifier, not the target.
- **Steck (KDD 2010), "Training and testing of recommender systems on data missing not at random":** *which* items a user has rated carries real information for top-k hit rate, and models trained only on observed rating values do much worse at it. ([Bell Labs page](https://www.nokia.com/bell-labs/publications-and-media/publications/training-and-testing-of-recommender-systems-on-data-missing-not-at-random)) So the *pattern of what's on the list* predicts what else is watched, and the rating values don't.
- **Marlin et al. (UAI 2007):** a user's opinion of an item affects whether they rate it (ratings are missing not at random) ([abstract](https://people.cs.umass.edu/~marlin/research/papers/cfmar-uai2007-abstract.txt)). Rating values are a biased view of consumption.
- **Cremonesi, Koren & Turrin (RecSys 2010):** for top-N tasks, "a naive non-personalized algorithm [popularity] can outperform some common recommendation approaches and almost match the accuracy of sophisticated algorithms" ([listing](https://puma.uni-kassel.de/bibtex/04cb3373b65b03e03225f447250e7873)). Popularity is a strong baseline for "has seen", and an honest one.

**Score weighting, answered:** for *will enjoy*, weighting seeds by high scores helps, because you want things like the ones they loved. For *already watched*, the literature above says the useful signal is the binary interaction. A user who dropped *Title A* has still watched part of it, and probably saw the hyped titles of the same season. I found no paper that tests "score-weighted vs binary seeds for recall" directly. The implicit-feedback framing (Hu 2008; Steck 2010) is the closest evidence. Recommendation: **binary seed weights, with a small optional confidence bump** (e.g. `1 + 0.25·[score ≥ user mean]`), because highly rated titles are more likely to have been followed into sequels and related works.

### 2.2 Signals available from AniList, ranked for recall

1. **Relations (`Media.relations.edges.relationType`)**, enum (verified): `PREQUEL, SEQUEL, PARENT, SIDE_STORY, SPIN_OFF, ALTERNATIVE, SUMMARY, COMPILATION, CONTAINS, SAME_UNIVERSE, CHARACTER, ADAPTATION, SOURCE, OTHER`.
   - If the user has watched S2, its `PREQUEL` (S1) is very likely watched. This is the strongest signal of all: people rarely start at S2.
   - If the user *completed* S1, its `SEQUEL` is likely watched, especially if the sequel aired a while ago. Discount it if the sequel is still airing or very recent.
   - If S1 was Dropped, its sequel is unlikely. This is the one case where status, not just "on list", matters.
   - `SIDE_STORY`, `SPIN_OFF`, `SUMMARY`, `COMPILATION` and `ALTERNATIVE` are weaker, and recap films are often skipped. Ignore `ADAPTATION`, `SOURCE` and `CHARACTER`: they point at manga or novels, or are noise.
   - Franchise chains also cover the "franchise completionist" pattern. Walking 2 hops covers S1 → S2 → S3.
2. **AniList recommendations (`Media.recommendations`, sort `RATING_DESC`)**: user-voted "if you liked X, watch Y" pairs, where `rating` is the net vote count (e.g. *Shingeki no Kyojin* → top rec at 2893). They work as a crowd-sourced **item-item co-occurrence proxy**: people only recommend pairs they have watched both of. Aggregate them across all of the user's watched seeds. A candidate recommended *from many of the user's titles* is a strong hit.
3. **Popularity in the user's era/format.** Popularity alone already gets many "seen" hits (Cremonesi; Rashid). Making it relative to the user's own start-year distribution and format mix (TV / movie / ONA) turns a global prior into a personal one cheaply. Use `stats.statusDistribution` to compute **watched count = popularity − PLANNING**:
   - *Shingeki no Kyojin*: 1,063,311 popularity, 72,755 Planning (7%).
   - *Tensei Shitara Ken Deshita 2nd Season* (currently trending): 46,123 popularity, **30,181 Planning (65%)**.
   - Raw popularity over-ranks hyped or airing titles for a recall task.
4. **Content similarity (genres, tags with `rank`, studios).** This is good for *taste* but weak for *recall*: sharing "Military" + "Survival" tags doesn't mean the user saw the title. Use it as a tie-breaker and to keep batches diverse. If used, weight tags by `rank/100` and skip `isMediaSpoiler` tags for display.
5. **True collaborative filtering** (co-occurrence over other users' lists) is the textbook answer. It isn't feasible client-side at 30 req/min, because the app would need thousands of other users' lists. AniList recommendations (2) are the practical substitute.

### 2.3 Prior work on choosing *which* items to ask about

**Rashid et al., "Getting to Know You" (IUI 2002, IUI 2020 Most Impactful Paper)** compared six strategies for picking items to show new MovieLens users. The successful ones "balance **popularity** (the likelihood of having an opinion) with **entropy** (the degree to which opinions differ)." ([GroupLens news](https://cse.umn.edu/cs/news/grouplens-paper-new-users-selected-acm-iui-2020-most-impactful-paper), [paper PDF](https://files.grouplens.org/papers/voi-final.pdf))

AniDuel's goal is only the "likelihood of having an opinion" half: get the user to recognise titles. The entropy half doesn't apply, because AniDuel does the ranking later in Duels. So the onboarding page should optimise **hit rate** (fraction of shown titles the user marks Completed/Dropped), plus a bit of diversity.

## 3. Exploration, diversity, cooldown

- **Mix slots in each batch (exploit/explore).** Taken together, the products above suggest a fixed split per batch of 20:
  - **about 12 "strong" slots**: relations plus high recommendation-aggregate scores;
  - **about 5 "era-popular" slots**: top watched-count titles in the user's years and formats that aren't on the list yet;
  - **about 3 "explore" slots**: popular titles *outside* the user's usual years and formats, or under-sampled genres. These catch eras the list doesn't show yet, e.g. a user who logged only recent anime but watched 2000s shows as a kid.
  - Shift the split based on hit rate. If explore slots hit, grow them (a simple ε-greedy or Thompson-sampling approach per slot type).
- **Diversity within the batch.** Re-rank with **MMR** ([Carbonell & Goldstein, SIGIR 1998](https://people.eng.unimelb.edu.au/ammoffat/sigir98/abstracts/carbonell.html); survey: [arXiv 2212.14464](https://arxiv.org/pdf/2212.14464)): `pick argmax λ·score(c) − (1−λ)·max_sim(c, picked)`, with λ ≈ 0.7.
  - Similarity can be cheap: same franchise (a shared relation component) = 1, else tag-overlap Jaccard.
  - In practice: **at most 2 entries per franchise per batch**, so five *Monogatari* entries don't fill a page.
- **Adaptive expansion.** Every title marked Completed/Dropped in batch *k* becomes a seed for batch *k+1*: fetch its relations and recommendations. This is the Vevo/MovieLens-groups pattern, and it's where the franchise chain pays off.
- **Cooldown / suppression for skips.** There is research on this: LinkedIn's **impression discounting** (Lee, Lakshmanan, Tiwari, Shah, KDD 2014) models the drop in conversion with **ImpCount** (how often the user has seen the item) and **LastSeen** (how recently) ([slides](https://slideshare.net/mitultiwari/impression-kdd)). A simple version for AniDuel:
  - Treat **skip as a soft "haven't seen"**. Multiply that item's score by `0.3^skips` and hide it for the rest of the session.
  - **After 2 skips, suppress it permanently** (keep it in a `dismissed` set in localStorage).
  - Optionally add an explicit **"Haven't seen"** button that suppresses on the first press, separate from "skip/unsure".
  - Re-surface suppressed items only if a *new* strong signal appears, e.g. the user later marks its prequel Completed.
  - **Negative propagation:** a skip on S1 should also down-weight S2/S3 (multiply by 0.5).
  - **Planning answers:** not a "seen" seed. Don't expand from them.
  - **Titles already on the user's Planning list:** a separate, optional "Did you actually watch these?" pass, because Planning lists often go stale. It can come straight from `MediaListCollection(status: PLANNING)` and needs no scoring.

## 4. AniList GraphQL practicalities

### Rate limits (verified 2026-10-08)
- Docs ([docs.anilist.co/guide/rate-limiting](https://docs.anilist.co/guide/rate-limiting)): *"The API is currently in a degraded state and is limited to 30 requests per minute. This is a temporary measure… The AniList API has a rate limit of 90 requests per minute."*
- Live response headers: `X-RateLimit-Limit: 30`, `X-RateLimit-Remaining: 29`. Going over the limit gives a **1-minute timeout**, a `429` with `Retry-After` and `X-RateLimit-Reset`, and a separate **burst limiter**.
- **"We are not currently accepting requests for increased rate limits."** Design for 30/min. Read `X-RateLimit-Limit` at runtime so the app speeds up automatically if the limit goes back to 90.

### Query facts (verified)
- `Page(perPage: 100)` is clamped to **50**. `pageInfo.total` caps at 5000.
- `Media` filters exist for `id_in`, `id_not_in` (a 400-id list works), `onList` (needs auth: filters by the Viewer's lists), `format_in`, `genre_in`, `tag_in`, `minimumTagRank`, `seasonYear`, `startDate_greater/_lesser`, `popularity_greater`.
- `MediaSort` includes `POPULARITY_DESC`, `TRENDING_DESC`, `SCORE_DESC`, `FAVOURITES_DESC`, `START_DATE_DESC`.
- `RecommendationSort` values: `RATING_DESC`, `RATING`, `ID`, `ID_DESC`.
- **One request = 50 media × (tags + relations + 25 recommendations)** succeeded with no complexity error (about 126 KB). AniList's complexity limit isn't documented, so keep `recommendations(perPage)` at 25 or less and test before going higher.
- `Media.stats.statusDistribution { status amount }`: `popularity` equals the sum of all five statuses (checked on *Shingeki no Kyojin*: 66,331 + 72,755 + 890,927 + 16,717 + 16,581 = 1,063,311).
- `Media.mediaListEntry` (with auth) returns the Viewer's own entry inline. It's handy for marking "already on list" in a discovery query.

### Suggested queries

Seed expansion runs once per 50 seeds, and the recommended media come back fully formed, so no second fetch is needed:

```graphql
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids, type: ANIME) {
      id
      relations { edges { relationType node { id type format status startDate { year } popularity
        title { romaji english native } coverImage { large color } } } }
      recommendations(perPage: 25, sort: RATING_DESC) { nodes { rating mediaRecommendation {
        id format status startDate { year } popularity
        title { romaji english native } coverImage { large color } } } }
    }
  }
}
```

Era-popular backfill (1–2 requests per batch):

```graphql
query ($from: FuzzyDateInt, $to: FuzzyDateInt, $formats: [MediaFormat], $exclude: [Int]) {
  Page(perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false,
          startDate_greater: $from, startDate_lesser: $to, format_in: $formats, id_not_in: $exclude) {
      id popularity startDate { year } format
      stats { statusDistribution { status amount } }
      title { romaji english native } coverImage { large color }
    }
  }
}
```

Use `onList: false` with the user's token instead of a huge `id_not_in`. **Verify** this before relying on it: it was only checked to be accepted without auth, where it had no effect.

### Request budget (300-title list, 30/min)
- Full list, **all statuses** (needed to exclude everything already listed, Planning included): 1 request. The `MediaListCollection` chunk is 500 per request.
- Seed expansion: 6 requests for 300 seeds.
- Era backfill: 1–2 requests.
- **Total: about 8–9 requests**, about 20 s at the existing 2.2 s spacing.
- Later batches only expand the *new* seeds the user just marked, so 1 request per batch.
- Cache the candidate pool in localStorage alongside the existing progress.

### Writing statuses
- `SaveMediaListEntry(mediaId, status)` (verified args: `id, mediaId, status, score, scoreRaw, progress, …, completedAt`) creates or updates **one** entry per call.
- `UpdateMediaListEntries(ids, status…)` exists but takes **list-entry ids**, so it can only change entries that already exist, not add new ones.
- `DeleteMediaListEntry(id)` is available for undo.
- **20 marks ≈ 20 requests ≈ 45 s.** Queue them through the existing throttled runner in the background, and don't block the next batch on them.
- GraphQL lets you alias several `SaveMediaListEntry` calls in one mutation document, which might count as one request. **This is untested here and would need a spike**, because the burst limiter or a complexity cap might reject it.
- When setting `COMPLETED`, consider sending `progress: episodes`, so AniList's progress isn't left at 0. Check how AniList fills progress on its own before relying on that.

## 5. What the repo already has

- `src/anilist/gateway.ts`:
  - `MEDIA_LIST_QUERY` = `MediaListCollection(userId, type, status_in, chunk, perChunk: 500)`. It returns `mediaId, status, score(POINT_100), completedAt` and media fields `title, coverImage, bannerImage, startDate.year, format, episodes, chapters, siteUrl`.
  - `TRENDING_QUERY` = `Page { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) }` for the logged-out Start screen.
  - `SAVE_SCORE_MUTATION` sends only `mediaId, scoreRaw`.
  - Errors are typed (`auth | rate-limited | unreachable | api`), and `rateLimit()` exposes the headers.
- `src/import/runner.ts`: `WRITE_SPACING_MS = 2200` ("keeps under AniList's 30 requests a minute"), with 429 handling via `resetAt`. Reuse it for status writes.
- **What needs adding:**
  - a list fetch with *all* statuses (only for exclusion);
  - a seed-expansion query (relations + recommendations);
  - an era-backfill query (`POPULARITY_DESC` + `stats.statusDistribution`);
  - a `SaveMediaListEntry(mediaId, status)` mutation.
- The data the app already loads gives `year` and `format` for the era/format profile, at no extra cost.
- **Glossary note:** `GLOSSARY.md` uses **Forgotten** for "can't judge" and avoids "Skipped". The onboarding "skip" needs its own term, so it isn't confused with Forgotten.

---

## 6. Recommendation

### Recommended (A): additive recall score with franchise/recommendation seeds plus an era prior, MMR batches, skip discounting

Let **S** = the user's *seen* titles: status ∈ {COMPLETED, CURRENT, PAUSED, DROPPED, REPEATING}, plus anything marked Completed/Dropped during onboarding. For each candidate `c` not on the list and not suppressed:

```
seed weight      w_s   = 1 + 0.25·[score_s ≥ user mean]      (binary + small confidence bump; unscored = 1)

relation         Rel(c) = max over s∈S with edge s→c of  r(type, status_s, c)
                 r: s has c as PREQUEL/PARENT                → 1.0
                    s has c as SEQUEL and s COMPLETED/REPEATING → 0.8 × airedFactor(c)
                    s has c as SEQUEL and s DROPPED          → 0.1
                    SIDE_STORY / SPIN_OFF                    → 0.4
                    SUMMARY / COMPILATION / ALTERNATIVE      → 0.2
                    (2-hop through a relation chain: × 0.6)
                 airedFactor = 1 if finished > 1 year ago, 0.6 if finished < 1 year ago, 0.3 if still airing

recs             Rec(c) = 1 − exp( −Σ_{s∈S, s→c} w_s · log(1 + rating_sc) / 6 )
                 (saturates in [0,1]; ~1 strong rec or several weak ones push it high)

era-popularity   Pop(c) = log(1 + watched_c) / log(1 + watched_max)   where watched = popularity − PLANNING
                 Era(c) = share of the user's S whose start year lies within ±2 years of c's
                          (smoothed: add 1 per year), normalised to [0,1]
                 Fmt(c) = share of S with c's format (TV / MOVIE / ONA / OVA / SPECIAL), smoothed

base(c)  = 0.45·Rel + 0.30·Rec + 0.25·(Pop · (0.5 + 0.5·Era) · (0.5 + 0.5·Fmt))
final(c) = base(c) · 0.3^skips(c) · (0.5 if a related title was skipped)   ; suppressed if skips ≥ 2
```

Building the batch (20 titles):
- 12 slots from the top `final`, 5 era-popular slots (highest `Pop·Era·Fmt` among titles with Rel = Rec = 0), and 3 explore slots (high `Pop`, low `Era` or `Fmt`).
- Within each group, apply MMR with λ = 0.7, and allow at most 2 titles per franchise.
- After each batch, add new Completed/Dropped titles to S, expand them (1 request), and rescore.
- Track hit rate per slot type and move slots toward whichever type is hitting.

- **Pros:**
  - Uses AniDuel's unique advantage, the existing list, from batch 1.
  - Relations catch the "obviously watched S2" cases that popularity misses.
  - Every weight is understandable and easy to tune by hand.
  - About 8 requests to start, then 1 per batch.
- **Cons:**
  - Hand-set weights need a tuning pass. Log hit rate per signal to tune them.
  - It depends on AniList recommendation coverage, which is thin for obscure or old titles; the era prior covers that gap.
  - `stats` adds payload to the backfill query.

### Alternative (B): popularity within the user's era only (Letterboxd/Goodreads style)

Show the top `watched = popularity − PLANNING` titles, filtered to the user's year range and formats, excluding the list, with skip suppression.

- **Pros:**
  - About 1 request per batch, trivial to build.
  - Matches what every product in §1 does, and Cremonesi 2010 shows popularity is a strong baseline for "has interacted".
  - Never feels "creepy" or off-target.
- **Cons:**
  - Misses franchise follow-ups and niche titles, which are exactly the ones users forget to log.
  - The hit rate drops fast after the first few batches, because the obvious hits get used up.
  - It's the same for every user in a cohort.

### Alternative (C): learn the weights in-session (online logistic regression or bandit)

Use the same features as A (Rel, Rec, Pop, Era, Fmt, tag-Jaccard). Each answer is a label: Completed/Dropped = 1, skip / "haven't seen" = 0, Planning = 0. Fit a tiny logistic regression, or Thompson sampling over slot types, after each batch, starting from A's weights as the prior.

- **Pros:**
  - Adapts to each user: e.g. someone who never watches sequels, or who only logs movies.
  - The weight-tuning work goes away over time.
  - The explore/exploit split is principled instead of fixed.
- **Cons:**
  - More code and harder to test deterministically.
  - Only about 20 labels per batch, so it's noisy for the first 2–3 batches and needs a strong prior (i.e. A anyway).
  - It's harder to explain why a title showed up.
  - It's over-engineering if users typically stop after 3–5 batches.

**Suggested path:** ship **A** with per-signal hit-rate logging, keep **B** as the fallback when the user's list is tiny (fewer than about 10 seen titles), and consider **C** only if logs show the fixed weights are clearly off for many users.
