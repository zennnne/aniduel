# Top Studio Score

A score function that ranks an AniList user's **top animation studios** from their own list — without using their *favourite studios* (that's the answer we're trying to infer, not an input).

Status: v2.7 (v2.1 from the grilling session on 2026-11-01; on 2026-11-02 fixes from a scrutinize review, a k decision, the user-average prior, label margins, one vote per entry, a gate that steps down for small lists, and a love count per franchise), prototyped in Python at `scripts/top-studio-score/prototype.py`, run on 8 real users. Not integrated into AniDuel! yet.

## Intent

- **"Top" = preference**, not engagement (count/minutes) and not "relative to the community".
- **Reward upside over safety.** A studio that swings (lots of 3–6, but some 9–10) should beat one that plays safe (all 7–8). The owner prefers the bold one.
- **Breadth still matters**: a studio with 4 titles and one masterpiece should not top the chart.
- Works for **any** user (any score format, unscored lists, small lists).

## Pipeline

### 1. Data (AniList GraphQL, no auth)
- `MediaListCollection(type: ANIME, chunk, perChunk: 500)` → `score(format: POINT_10_DECIMAL)` (normalises all 5 formats), status, progress, repeat, media `{episodes, duration, studios{edges{isMain node}}, relations{edges{relationType node{id}}}}`.
- `User.favourites.anime` / `.staff` (paged, 25/page).
- Per fav staff (only with `--staff`, see §6): `Staff.staffMedia(type: ANIME, perPage: 50)` → `{staffRole, node.id}`.
- ⚠️ `studios(isMain: true)` does **not** filter — read `edges.isMain` and filter client-side.
- ⚠️ Deeply nested queries (favourites → staffMedia → studios) return 500. Keep them flat.
- ⚠️ Rate limit ≈ 30 req/min; ~2.1 s spacing + retry on 429. A user with 60 fav staff takes ~10 min the first time → cache.
- Python `urllib` gets 403 without a `User-Agent` header.

### 2. Which entries
- Exclude `PLANNING`. Count COMPLETED, REPEATING, CURRENT, PAUSED, DROPPED.
- **Studio** = `isMain` studios only, full credit to each (co-productions not split).

### 3. Per-entry preference `z`
- `z = (score − mean_user) / max(sd_user, 0.5)` on the 10-point scale.
- If the user has < 10 scored entries → skip z, use status defaults only.
- Unscored entries (v2.5) count only through a signal the user gave: dropped → −1, rewatched (`repeat>0` or REPEATING) → +0.5, fav → 0 + the fav bonus. Unscored completed/current/paused entries are left out (w = 0).
- Dropped with a score → `min(z, −0.5)`.
- **Fav anime** → `z += 0.5` (flat; most users don't rank their favourites).

### 4. Per-entry weight `w`
- `w = ln(1 + episodes·duration/24) × min(1 + 0.5·repeat, 2)`
- CURRENT/PAUSED → `× progress/episodes`.
- DROPPED (v2.2) → episodes = what was watched, `min(max(progress, 1), episodes)`. Before this, a drop after 1 episode of a 24-episode show (ln 25 = 3.2) outweighed a finished 12-episode favourite (ln 13 = 2.56).
- **Mid-scores** `|z| < 0.5` → `× 0.5` (neutral titles shouldn't drag a studio down as much).
- **Unscored drops** (v2.5) → `× 0.5`: a drop says less than a real score.

### 5. Votes (per studio), v2.5
- **Every entry is its own vote**: sequels, movies, recaps (SUMMARY), alternative versions, everything. Up to v2.4 entries joined into franchise groups over SEQUEL/PREQUEL; see §11 for why that was dropped.
- Vote `Z = z`, `W = √w`, then rescale all W so mean W = 1 (so `k` reads as "k entry votes").

### 6. Fav staff affinity (pseudo-vote), off by default since v2.2
- **Off unless `--staff`.** On all 8 users the top 10 is the same 9–10 of 10 with or without it, and the owner's order doesn't change. It also counts evidence twice (fav staff come from titles already scored), uses a fixed Z = +1 for everyone, and is most of the AniList calls (~10 min first run). Kept for comparison only.
- Only staff credits on titles **in the user's list**, only production roles, weighted:

  | ×3 | ×2 | ×1 |
  |---|---|---|
  | Director, Chief Director | Series Composition, Storyboard, Key Animation, Episode Director, Script, Animation Director, Chief Animation Director | Character Design, Music, Art Director |

  Not counted: Original Creator, Theme Song, voice, producer, everything else.
- Each staff has 1 vote, split across studios by role-weighted share → `A_studio`.
- Add one pseudo-vote per studio: `Z = +1.0`, `W = A_studio` (only for studios already on the list).

### 7. Studio score
```
S = (1/α) · ln( (Σ W·e^(αZ) + k·Ū) / (Σ W + k) ) − (1/α) · ln Ū  +  γ · ln(1 + n_love)
    α = 1,  k = 13.1 (fixed, same for every user; 10.8 franchise votes up to v2.4),  γ = 0.1
    Ū = user's W-weighted mean of e^(αZ) over all votes   (S = 0 → an average studio for this user)
    n_love = Σ over franchises of max σ((Z − 0.9) / 0.15)   (soft count of loved works, v2.7; see §12)
```
The first term is an entropic (log-sum-exp) mean with `k` pseudo-votes at the user's average vote (v2.4, see §10). `k` reads as "a studio needs this much evidence before it is trusted", so it carries both noise shrinkage and the owner's sense of a proven track record. As α → 0 it becomes a plain mean, and a higher α leans toward the best title. On the owner's scale: a 10 ≈ 7.4 points, 8 ≈ 2.5, 6 ≈ 0.9, 3 ≈ 0.18. So a masterpiece is worth ~3 solid titles, while a flop costs at most ~Ū (≈ 1.5 for the owner).

**Love count (v2.1).** The first term is rate-like, so a studio with 2 loved titles out of 7 tied one with many more liked titles out of 14 (owner: Kinema Citrus vs TRIGGER, "I only like 2 of Kinema's"). The γ term rewards the absolute number of liked franchises (≈ 8+). The γ sweep on the owner's list:
- γ = 0 (fav split only): TRIGGER moves just above Kinema (+0.79 vs +0.71).
- **γ = 0.1, chosen:** TRIGGER leads Kinema clearly, and Shaft stays above MADHOUSE.
- γ ≥ 0.15: MADHOUSE (30 franchises of solid 8s) passes Shaft, which drifts toward engagement.

**Soft love count (v2.2).** v2.1 counted `Z ≥ 0.9` as a hard step, which brought back the threshold cliff rejected below: 5 franchises all at Z = 0.89 scored 0.374, all at 0.90 scored 0.559, a jump about the size of the gap between the owner's #1 and #5. A sigmoid with width 0.15 removes the cliff. The owner's top 10 keeps the same order.

### 8. Ranking & labels
- Ranked list only includes studios with **≥ 6 entries** (≥ 5 franchises up to v2.4); the rest with high S show as **🌱 watchlist** (top 5).
- **v2.6:** if fewer than 10 studios pass, the gate drops one entry at a time (5, then 4) until 10 pass or it reaches 4. Users with 10+ studios at 6 are unchanged. The output header shows the gate when it was lowered.
- Per-studio hit rate (vote Z ≥ 1.2) and flop rate (Z ≤ −1), compared to the **pooled rate of the top 20 ranked studios** of that user. Each rate counts as high only above the pool rate **+ 6 points** (+4 in v2.4, raised in v2.6, see Known issues #9):
  - 💎 Elite (hit↑ flop↓) · 🎲 Bold (hit↑ flop↑) · 🛡️ Reliable (hit↓ flop↓) · 💤 Meh (hit↓ flop↑)
- By construction 🛡️ rarely reaches the top 10 (S rewards hits; 🛡️ means few hits). That is intended for this owner's taste; a lower α would surface it.

### 9. Choosing k (v2.3)
Up to v2.2, `k = max(3, #franchises/60)`. That grows with list size, so the same studio record scored lower for a user who had watched more from *other* studios, and each user got a different idea of "top" (k: AnimeICU 12.2, owner 10.8, JackUTS 6.4, SigmaZzz 3.1). v2.3 fixes k at the owner's value, 10.8, for everyone. The owner's ranking is unchanged. The friends keep the same top 10 apart from neighbours swapping, and one swaps out its #10. (`--k=list` restored the old rule until v2.5.)

Why not a small k: the owner compared the options below and felt the v2.2 order made the most sense. A large k encodes "proven track record" (Shaft's 13 franchises vs GAINAX's 5), which is part of what the owner means by a top studio. γ was also tuned at k = 10.8.

**Considered and not adopted: separate shrinkage from breadth.** `k = #franchises/60` did two jobs. It shrinks noisy small studios, and it also quietly sets how much breadth counts. The same studio record scores lower for a user who has watched more from *other* studios (owner's Ghibli: +0.69 at k = 10.8, +1.06 at k = 3). The prior also sits at Z = 0 instead of the user's own average.
```
S = (1/α)·ln( (Σ W·e^(αZ) + k·Ū) / (Σ W + k) ) − (1/α)·ln Ū  +  γ·ln(1 + n_love)
    Ū = user's W-weighted mean of e^(αZ) over all franchises  (S = 0 → an average studio for this user)
    k = σ²_within / τ²_between, clamped to [2, 8]   or a fixed k ≈ 4
```
The prototype has it as `--prior=user --k=est|<number>`. Owner's top 6:
- `--k=est` (k ≈ 3), γ = 0.1: GAINAX, TRIGGER, KyoAni, Kinema, Brain's Base, Ghibli. Small studios rise and Kinema returns to the top 5, which the owner already complained about.
- `--k=4 --gamma=0.3`: KyoAni, TRIGGER, GAINAX, MADHOUSE, Kinema, Shaft. Shaft falls from #3 to #6.

Both go against v2.1 choices: no single γ keeps Shaft above both MADHOUSE (needs γ ≤ 0.2) and Kinema (needs γ ≥ 0.4). Still available as `--prior=user --k=4 --gamma=…`. `--prior=user` with k = 10.8 keeps Shaft #3 but drops MADHOUSE to #7. It became the default in v2.4 (§10).

### 10. Prior at the user's average (v2.4)
Up to v2.3 the `k` pseudo-votes sat at Z = 0 (utility 1). Every user's average franchise is above that (Ū = e^0.18 to e^0.44; owner Ū ≈ 1.54), so an exactly average studio for the owner scored +0.16 at 5 franchises, +0.23 at 10 and +0.33 at 30. That is a hidden breadth bonus on top of γ, while the owner's #1 to #10 gap was only 0.43. v2.4 puts the pseudo-votes at Ū and subtracts ln Ū, so γ is the only breadth knob and S = 0 means "an average studio for this user". `--prior=zero` restores v2.3.

**Check against held-out answers.** AniList favourite studios are never an input, so they work as ground truth. 3 of 8 users have any (13 studios). Mean rank of those studios, gate ≥ 5:

| | mean rank | in top 5 |
|---|---|---|
| v2.3 (prior Z = 0, γ = 0.1) | 4.9 | 9/13 |
| v2.4, γ = 0 | 5.4 | 9/13 |
| **v2.4, γ = 0.1, chosen** | 5.3 | 9/13 |
| v2.4, γ = 0.2 | 5.2 | 9/13 |
| v2.4, γ ≥ 0.3 | 5.4–5.8 | 8–9/13 |

With 13 labels, differences under ~1 rank are noise. γ = 0.1 is kept because γ ≥ 0.2 puts MADHOUSE above Shaft again (the v2.1 rule). The owner's labels were tuning targets, so only the 2 friends (8 labels) are truly held out.

Owner's top 10 at v2.4 (with the label margins below): Kyoto Animation 💎 +0.67, TRIGGER 💎, Shaft 💎, GAINAX 💎, Kinema Citrus 🎲, Brain's Base 🛡️, MADHOUSE 🛡️, Studio Ghibli 💎, Shin-Ei Animation 🎲, WHITE FOX 🛡️ +0.31. Against v2.3: MADHOUSE #4 → #7, GAINAX #6 → #4, CloverWorks #9 → #11 (+0.30). The owner accepted this order.

**Flop margin (v2.4).** The owner's MADHOUSE (30 franchises: 3 at 9+, nine at 8, 4 flops) was 💤 Meh at flop 13% vs a 12% baseline, though the owner reads it as 🛡️ Reliable. A studio the user watches a lot of picks up some flops just from volume, and with a strict `>` one title flipped the label. Compared:
- **+4-point flop margin, chosen.** MADHOUSE → 🛡️. Kinema stays 🎲. Also WHITE FOX → 🛡️, KyoAni 🎲 → 💎 (owner); Kinema 💤 → 🛡️, TRIGGER 🎲 → 💎 (Arisa2012).
- Second axis = share of franchises at or above the user's average, instead of flop. Fits "reliable" by name, but Kinema (29% flops) becomes 💎, against the owner.
- Flop vs the whole list's rate (20% for the owner). Almost everything becomes 💎, so labels stop separating.

**Hit margin (v2.4).** Same problem on the hit side: the owner's Brain's Base (8 franchises, one hit: Penguindrum 10, the rest 6–8) was 💎 Elite at hit 12.5% vs a 10.8% baseline. The same +4-point margin makes it 🛡️, and the owner's other labels don't change. For AnimeICU, GAINAX, ufotable and CygamesPictures go 💎 → 🛡️ and WHITE FOX 🎲 → 💤. Rejected: a count rule (≥ 1 hit above expected), which turns the owner's Shaft (2/13) into 🛡️ and removes almost every 💎. Still open: at 5 franchises one hit is already 20%, so GAINAX and Ghibli (1/5 each) stay 💎.

### 11. One vote per entry (v2.5)
Grilled on 2026-11-02. In v2.4 the owner's six Sound! Euphonium entries (10★, 9, 9, 8.5, 8.5, 7) made one KyoAni vote: Z = +1.65 (≈ 9.4 on the owner's scale, pulled up by the soft-max and the fav bonus), W ≈ 2 single titles. The owner rejected that: each season or film is its own piece of work and should be judged on its own.

Decisions:
- **No grouping.** Every entry is a vote, sequels at full weight. The fav split rule goes away with it.
- **Recaps count.** SUMMARY entries (Bocchi Recap) and compilation films (Madoka Part 1/2, Gurren Lagann films, recorded as ALTERNATIVE) are votes like any other. Considered: auto-detecting compilation films from ALTERNATIVE + film + same studio + released after the TV. Of the 50 film/OVA ↔ TV ALTERNATIVE pairs in the 8 lists, it would also catch new works (Heaven's Feel I, Utena: Adolescence, Clannad Another World, Steins;Gate 23β), so the owner dropped exclusion entirely.
- **Weight by runtime as before.** Short films stay light (owner's 10★ FGO Memorial Movie, W ≈ 0.26).
- **Unscored entries**: only drops (×0.5 weight), rewatches and favs count; unscored completed/current/paused are left out. Removes 49 entries for the owner, 221 for Arisa2012.
- **k and the gate scaled by the owner's entries per franchise, 1.21**: k = 10.8 → 13.1, gate 5 franchises → 6 entries, the same for everyone. Using each user's own ratio (0.91–1.21) gave the same mean rank (6.2 vs 6.2 in a run that still left out recaps), so the shared value stays, as in §9.
- **γ = 0.1 kept.** The love count is per entry now, but ln(1 + n) damps it, and the owner's v2.1 rules still hold (TRIGGER > Kinema by 0.01, Shaft > MADHOUSE).

Favourite-studio check (13 labels, same as §10):

| | mean rank | in top 5 |
|---|---|---|
| v2.4 | 5.3 | 9/13 |
| one vote per entry, recaps left out | 6.2 | 10/13 |
| **v2.5** | 5.3 | 10/13 |

Leaving recaps out dropped AnimeICU's CloverWorks to #27: their favourite is Bocchi (9.9, recaps 9.3 and 9.2), against 5 Rascal and 4 SPY x FAMILY entries around 7. With recaps it is #15 (#11 in v2.4). Arisa's ufotable #15 → #12. The owner's CloverWorks #11 → #12.

Owner's top 10 at v2.5: Shaft 💎 +0.78, Kyoto Animation 💎, TRIGGER 💎, Kinema Citrus 🎲, GAINAX 💎, Brain's Base 🛡️, MADHOUSE 💤, Shin-Ei Animation 💎, ufotable 🛡️, Toei Animation 🛡️ +0.35. Shaft takes #1 because Madoka and Monogatari now count per entry. Labels are open: hit and flop rates are per entry now, the ±4-point margin was set on franchises, and MADHOUSE is back to 💤.

### 12. Love count per franchise (v2.7)
Asked 2026-11-02: the owner's Shaft (+0.78) was #1 over Kyoto Animation (+0.73), while the owner's own AniList favourite studios list KyoAni first, then Shaft. Cause: v2.5 made every entry a vote, so the love count also became a count of entries. Shaft's 16 entries at Z ≳ 0.9 are mostly Monogatari and Madoka. KyoAni's loved titles are many different works (Euphonium, Clannad, A Silent Voice, Hyouka, K-ON!, Tamako, Violet Evergarden).

Change, γ term only:
- Entries of one studio joined by SEQUEL/PREQUEL form a franchise. Each franchise adds at most 1 to `n_love`, from its best entry.
- **Fav split (back from v2.1):** in a franchise with ≥ 2 fav entries, each fav adds on its own. The non-fav rest stays one. Without it, the owner's SSSS.GRIDMAN ★ and SSSS.DYNAZENON ★ (one SEQUEL chain) counted as one love, and Kinema Citrus passed TRIGGER at γ = 0.1.
- Votes, weights, the fav bonus and `k` are unchanged. Every entry is still its own vote (§11), so this doesn't bring back the 1/√n down-weighting rejected below.

Measured (owner rules: KyoAni > Shaft as asked, TRIGGER > Kinema, Shaft > MADHOUSE; check = §10's 13 favourite studios):

| | KyoAni vs Shaft | TRIGGER − Kinema | check mean rank / top 5 |
|---|---|---|---|
| v2.6 | +0.73 < +0.78 | +0.01 | 5.3, 10/13 |
| α = 0.4 (no other change) | +0.77 < +0.78 | Kinema under GAINAX | — |
| fav bonus 1.0 | +0.80 < +0.82 | tie | 5.2, 9/13 |
| per franchise, no fav split, γ = 0.1 | +0.70 > +0.66 | Kinema ahead | 5.4, 10/13 |
| per franchise, no fav split, γ = 0.2 | +0.95 > +0.81 | +0.02 (MADHOUSE #7 → #5) | 5.4, 10/13 |
| **per franchise + fav split, γ = 0.1, chosen** | +0.70 > +0.66 | +0.03 | 5.4, 10/13 |

The check moves less than 1 rank, which is noise (§10). The change makes the owner's order match their own favourites without hurting the friends. The tradeoff the owner accepted: favouriting many entries of one franchise counts each one in `n_love`, damped by ln(1 + n). Non-fav sequels never add more than 1.

Owner's top 10 at v2.7: Kyoto Animation 💎 +0.70, Shaft 🛡️, TRIGGER 💎, Kinema Citrus 🎲, GAINAX 💎, Brain's Base 🛡️, MADHOUSE 🛡️, Shin-Ei Animation 🛡️, Toei Animation 🛡️, WHITE FOX 🛡️ +0.32 (ufotable #9 → #11).

## Decisions rejected (and why)
- Mean + λ·SD — symmetric, rewards flops too.
- Hit-rate threshold as the score — cliff at the threshold.
- Weighting by minutes — turns preference into engagement.
- Ranked fav-anime bonus — most users don't rank favourites.
- Staff career-wide works — dilutes with old key-animation credits; in-list only.
- Median-based label thresholds — degenerate to 0% (most studios have no hits).
- Labels from "studio style" (original ratio, community score variance) — would change the label from *user's taste* to *studio's nature*; owner declined.
- Down-weighting long franchises, 1/√n per entry (tried 2026-11-02 after v2.5): franchise = SEQUEL/PREQUEL chain within the studio, the same factor on vote weight and love count. It took the owner's Shaft from +0.78 (#1) to +0.58 (#2, under KyoAni), with Monogatari being 14 of its 27 entries. Favourite check 5.0 mean rank, 9/13 in top 5 (v2.5: 5.3, 10/13). Rejected because AniList relations can't tell a continuation from a new story in the same universe: SSSS.GRIDMAN → DYNAZENON → Gridman Universe is a SEQUEL chain, so TRIGGER got divided too and fell below Kinema Citrus (#5 vs #4), breaking the owner's rule. Title matching fails on Monogatari, and character overlap needs more data and still trips on crossovers like Gridman Universe. Shaft at #1 is real taste anyway: Monogatari alone scores +0.74. Down-weighting only partly (n^-0.25) wasn't run; it has the same false matches.

## Findings from 8 users
See §10 and §11 for v2.4 and v2.5. Owner (zennnne) top 10 at v2.1 (γ = 0.1): Kyoto Animation 💎, TRIGGER 💎, Shaft 💎, MADHOUSE 🎲, Kinema Citrus 🎲, GAINAX 💎, Brain's Base 💎, Studio Ghibli 💎, CloverWorks 💎, Shin-Ei Animation 🎲.
At v2, GAINAX and Kinema Citrus showed up near the top for most of the friend group. The 7 friends have not been re-run on v2.1.

## Known issues / open
0. Favourite studios that rank low (v2.5): CloverWorks (a favourite of 2 users) at #12 and #15, ufotable (1 user) at #12. Only 13 favourite-studio labels from 3 users; more users with favourite studios would make the check meaningful.
9. Labels after v2.5, settled in v2.6. With per-entry rates the owner's MADHOUSE went back to 💤: 6 flops in 36 (17%) against a 15% cutoff (11% pool + 4), and half of them are Overlord I–III, scored 4 each. Measured on all 8 users' top 10s:
   - flop margin +7, hit margin +4: only owner MADHOUSE → 🛡️ and AnimeICU Shin-Ei 🎲 → 💎.
   - **±6 on both, chosen by the owner**, so both rates follow one rule.
   - shrinking rates toward the pool (20 pseudo-entries): almost everything becomes 🛡️.
   Changes at ±6 vs ±4 for the owner: Shaft 💎 → 🛡️ (hit 15% < 16%), MADHOUSE 💤 → 🛡️, Shin-Ei 💎 → 🛡️. Others: AnimeICU Shin-Ei 🎲 → 🛡️, Arisa WHITE FOX 💎 → 🛡️, ManMode KyoAni 💎 → 🛡️, Tine Kinema Citrus 🎲 → 💤. Side note: the owner's 8.5 is z = +1.19, just under the 1.2 hit line, so many of the owner's 8.5s (Orb, Bakemonogatari, 3-gatsu) miss being hits by 0.01.
1. Ranking gate, small lists. v2.5 left Keennaja and SigmaZzz with 4 ranked studios each. Two v2.5 changes caused it: dropping unscored completed entries (SigmaZzz scored 128 of 221, so this was the bigger cut) and the gate going 5 franchises → 6 entries. A gate of 4 for everyone was measured and rejected: favourite check 6.1 mean, 9/13 (gate 5: 5.5, 10/13). It let 4–5-entry studios into big lists (ManMode's OLM +0.60 and Tatsunoko +0.57, Tine's GAINAX +0.73 at #2). Fixed in v2.6 by the step-down gate: SigmaZzz gets 10 at gate 4, Keennaja 6 at gate 4 (the list is too small for 10), everyone else stays at 6, and the check stays 5.3 and 10/13.
2. Users who score < ~50% of their list: unscored drops (−1, half weight since v2.5) still count fully in the flop rate → noisy 🎲 labels; `MIN_SCORED = 10` is too low a gate. Candidate: gate on scored fraction.
3. Multi-studio titles (Evangelion → GAINAX + Tatsunoko + Production I.G) give full credit to each. Simple fix: 1/m credit per studio.
7. The mid-score halving at |z| < 0.5 is a step (owner: a 7 gets half weight, a 7.5 full).
8. Adding one above-average but not loved title can lower a studio's S (rate-like score). With one vote per entry, a long run of middling sequels weighs more than before. Acceptable if "top" means typical quality, not volume.
4. Fav staff who are only voice actors contribute nothing (by design).
5. Owner *feels* TRIGGER is 🎲, but their scores say otherwise (mostly 6–8, one flop).
