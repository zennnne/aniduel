# Keep My Scale scoring: what the codebase already has

Internal half of the question "is there a better way to work out a picked title's score than `src/ranking/keepMyScale.ts`?". It covers what the repo already does with comparisons, which decisions are already recorded, what can be measured today, and what a replacement could be built from without a new dependency.

Researched 2026-10-12 on the working tree of `main` at `4679a40`. **The working tree has uncommitted changes**: `src/ranking/keepMyScale.ts`, `src/ranking/engine.ts`, `src/ranking/keepMyScale.test.ts` are modified and `docs/adr/0012-...md` is untracked (the ADR 0012 work). Every line number below is from that working tree, not from `HEAD`.

Each finding is marked **Read** (seen in a file, ADR or issue) or **Inferred** (my reasoning from what was read). Section 3 has numbers marked **Measured**: I ran them with a scratch script that is not in the repo.

---

## TL;DR

- **Keep My Scale reuses almost nothing from the other two Sort Goals.** From `scoring.ts` it takes only `levels` (to validate the snapshot) and `humanStepPast` (the score past the extremes). The search, tie handling, settledness and estimate are all written a second time, in a different encoding. (Read)
- **Its search is the Full Ranking binary insertion with Anchor levels in place of Tiers.** `2k+1` positions is the same space as an insertion interval over `k` Tiers (`levelSelect.ts:40-42`). What has no counterpart anywhere else in the repo is the voting: `vote`, `decide`, `nextVoter`, `range` and the Suspect bookkeeping, about 170 of the file's 526 lines. (Read + Inferred)
- **Confirmation is the one thing a replacement may not drop.** ADR 0012 built "settle at the first win and loss" and rejected it with numbers: titles a score or more off went from about 2% to about 11%. Its closing sentence is "Rejected: every boundary must stay confirmed." (Read)
- **Any new rule is additive.** ADR 0005 and ADR 0012 require old logs to replay under the rule they were answered with, so a new method means engine 11, a new rule name in `anchors-set`, and the two existing rules staying in the code. (Read)
- **There is no checked-in simulation of a realistic user for Keep My Scale.** The oracle in `keepMyScale.test.ts` only asserts bounds and assumes every Anchor of a score is exactly equal. The numbers quoted in ADR 0012 come from a run whose script is not in the repo. (Read)
- **Measured today** (scratch script, section 3): 5.1 Duels per title on the test's own setup, which is 0.92 of the Start estimate and 1.39 times an unconfirmed search, not "about twice". On 7 Anchor scores: 6.0 to 6.4 Duels per title, 0.4% to 2.1% of titles a whole score off, none two off.
- **The biggest lever found is not the algorithm.** A simulated user who answers "about the same" within a quarter point is asked the Closer-to prompt for 41% of titles; one who never does, 61% to 83%. (Measured)
- **Four options built only from existing patterns are in section 4.** Only one (D, let a run of consistent answers confirm each other by transitivity) could save a meaningful number of Duels, and it is the one closest to the confirmation rule, so it needs numbers before it is offered.

---

## 1. Everything in the repo that turns comparisons into an order or a score

### 1.1 Full Ranking: binary insertion over Tiers

**Read.**

- `src/ranking/engine.ts:434` `Insertion = { id, above: Tier | null, below: Tier | null }`: a title's search state is two bounds held as Tier identities, so they survive other titles leaving (`removeTier`, `engine.ts:533-540`: "A bound on it moves one Tier further out, which is still true by transitivity").
- `engine.ts:497-501` `insertionInterval`, `engine.ts:1076-1077`: the pivot is `Math.floor((interval.lo + interval.hi) / 2)`.
- `engine.ts:616-641` `duel-answered`: a win sets `insertion.below = pivot`, a loss sets `insertion.above = pivot`, and a tie ends the search at once: `pivot.members.push(insertion.id)` (line 634).
- `engine.ts:507-514` `placeEmptyFronts`: an empty interval becomes a new Tier.
- The pivot's face is always `tier.members[0]` (`engine.ts:625`, `1101`; ADR 0005 "Tier pivots").
- One answer moves a bound. ADR 0001 Consequences: "A single wrong answer puts a title in the wrong place for good, so undo and Re-rank are required features, not optional ones."

**Keep My Scale: solves the same sub-problem a different way (duplicates).** `keepMyScale.ts:5-7` searches "2k+1 positions for k Anchor levels", `keepMyScale.ts:299-305` `openLevels` takes `middle: Math.floor((first + last) / 2)`. `levelSelect.ts:40-42` describes an insertion interval as "it may land in the gaps lo..hi (between Tier lo-1 and Tier hi), or tie a Tier lo..hi-1", which is the same `2k+1` places.

**Inferred.** An Anchor level is a Tier in every respect the engine cares about: titles the user considers equal, sharing one score (GLOSSARY "Tier"). The two differences are that Keep My Scale never lets one answer move a bound, and that it rotates the face of the pivot (`nextVoter`, `keepMyScale.ts:353-363`) where the Tier engine always shows `members[0]`.

### 1.2 Scores: level-targeted multi-selection

**Read.**

- `src/ranking/levelSelect.ts:1-3`: "Pure and stateless: everything is derived from the Segment's Tiers and insertion bounds, so any event (an answer, a settings change, a title taken out) is picked up as is."
- `levelSelect.ts:89-119` `knowledgeOf`: each title gets a range of positions; `levelSelect.ts:110` `settledIn = (r) => levelAt(r.min) === levelAt(r.max)`. A title is settled when every position still open to it gives one level.
- `levelSelect.ts:135-244` `nextLevelDuel`: sample by binary insertion, pivots at predicted level boundaries, then `towardsPivot` (`levelSelect.ts:171-181`) picks "the pivot in u's interval nearest the middle of u's expected positions". ADR 0007 calls it "a search weighted by group size".
- `scoring.ts:280-287`: `score()` gives a level only to settled titles and lists the rest in `unsettled` with "the levels it can still get, best first".

**Keep My Scale: solves the same sub-problems a different way.**

- "Which levels can this title still get, and is it settled" is `standing` (`keepMyScale.ts:263-293`) plus `keepMyScaleView` (`keepMyScale.ts:511-526`), returning `PickedTitle = { id, settled, levels }` (`keepMyScale.ts:29`), the same shape as `UnsettledScore` (`scoring.ts:35`).
- It is half stored, half derived. `answerAnchorDuel` writes the narrowed range back (`keepMyScale.ts:447` `Object.assign(placement, range(state, placement))`) because "a decided boundary is never reopened by later answers" (`keepMyScale.ts:438-439`), while `range` (`keepMyScale.ts:426-434`) is "Derived, so a Forgotten or Brought back Anchor changes it without an answer". `Placement.closer` stores the range it was asked at (`keepMyScale.ts:63`) and `contradicts` "is kept as it was then" (`keepMyScale.ts:55-56`).
- It does not weight the search. The start is the middle level by index (`keepMyScale.ts:304`), whatever the number of Anchors on each level.

### 1.3 `scoring.ts`

**Read.**

| Function | Lines | Keep My Scale |
|---|---|---|
| `levels(format, step)` | `scoring.ts:129-135` | **Reused**, only to validate snapshot scores (`keepMyScale.ts:118`) |
| `humanStepPast` | `scoring.ts:101-109` | **Reused** (`keepMyScale.ts:499-500`); Keep My Scale is its only caller |
| `scoreRawOf`, `levelOfRaw` | `scoring.ts:124-126`, `138-152` | **Reused** by Preview for its rows (`preview.ts:105`, `113`) and by `anchorsOf` (`src/pool/anchors.ts:29`) |
| `levelAt`, `rawValue`, `score`, Distribution, `ScoringSettings` | `scoring.ts:58-66`, `261-298` | **Not used**, by design: ADR 0009 "works the other way round" from position-to-score |
| `levelGroups` | `scoring.ts:308-320` | **Duplicated**: returns null without `standing`, so `keepMyScaleLines` (`src/ui/rankingLines.ts:48-66`) and `keepMyScaleRows` (`preview.ts:99-122`) group by level themselves |

A Keep My Scale log still starts with a `scoring-set` it never uses (`engine.ts:396-397`: "unused by this Sort Goal, but Preview and Import read the Score Format from them").

### 1.4 Ties

**Read.**

- Full Ranking and Scores: one "about the same" joins the Tier and ends the title's Duels (`engine.ts:632-636`; ADR 0007 "Ties work as before").
- Keep My Scale: a tie is one vote. `keepMyScale.test.ts:180-195` asserts the title is still `settled: false` after one tie and settles on the second.
- Spec #36 story 10 still reads "I want 'About the same' against an Anchor to give the new title that Anchor's score, so that ties resolve instantly"; ticket #45 added the second Anchor.

**Different way**, on purpose.

### 1.5 Confirmation

**Read.** Keep My Scale is the only place in the repo with any redundancy.

- `keepMyScale.ts:383-389` `vote`, `400-420` `decide`, `335-340` `voterLevels`, `353-374` `nextVoter`. `decide` has five ways out (lines 408, 415, 416, 417 and 418-419).
- Elsewhere redundancy was tried and rejected: ADR 0006 "Random spot-check Duels to catch wrong answers: rejected. They caught only about 40% of real misplacements and raised more false alarms than true ones."
- The reason given for confirming here is Anchor drift, not mis-taps: ADR 0009 "A boundary is passed only when two different Anchors agree", and #36 story 15 "As a user whose old scores have drifted".

**Nothing to reuse.**

### 1.6 Hesitation

**Read.** `src/ui/duel/hesitation.ts:4` `HESITATION_MS = 20_000`; `src/ui/duel/DuelScreen.tsx:123` turns it into a nudge on the "About the same" button, for every Duel screen, Anchor Duels included. It is UI only: nothing is written to the Duel log, so replay and scoring never see it.

**Not used by any scoring.** See the tie-rate measurement in section 3 for why it matters more under Keep My Scale than elsewhere.

### 1.7 Replaying answers from the log (ADR 0005)

**Read.** Keep My Scale **reuses** all of it.

- Undo: `resolveUndo` (`engine.ts:547-571`) drops cancelled events before `apply` sees them; `anchors-set` is a barrier, `closer-to-answered` a user event (`engine.ts:177-178`).
- Prompt check: `answerAnchorDuel` returns false unless the answer is for the Duel `nextQuestion` gives now (`keepMyScale.ts:441-443`), and the engine throws `wrongDuel` (`engine.ts:619`). The same for `answerCloserTo` (`keepMyScale.ts:466-468`, `engine.ts:743-749`).
- Seeded choices: `seededHash` (`src/ranking/hash.ts:5-17`, "Never `Math.random`") picks which Anchor of a level a title meets first (`keepMyScale.ts:357`, with `VOTER_SALT`, line 346: "Changing it changes replay").
- Versioning: `ENGINE_VERSION = 10` (`engine.ts:34`), `EVENT_RULES[...].since` (`engine.ts:163-179`), and the rule named inside the snapshot (`engine.ts:733-736`, `SplitRule` at `keepMyScale.ts:73`).
- Golden data: `src/ranking/fixtures/engine9-anchors-backup.json` is replayed in `src/persistence/backup.test.ts:3`.

### 1.8 Estimates

**Read.** `src/ranking/estimate.ts` is `log2(k!)` per Band with `SCORES_SAVING = 0.42` (line 14) and `REFINE_DUELS_PER_BIT = 1` (line 129), both commented as measured with an oracle. Keep My Scale has its own one-liner elsewhere: `src/pool/anchors.ts:81-83` `Math.round(2 * n * Math.log2(levels + 1))`.

**Duplicated, and slightly off the search it describes**: the search is over `2k+1` positions (`keepMyScale.ts:5`), the estimate uses `log2(k+1)`.

### 1.9 Old scores to a starting point

**Read.** `src/ranking/fromScores.ts:31-59` `planFromScores` cuts old scores into Bands by z-score (ADR 0008). It is the only other code that reads existing scores, and it produces Bands, not an order. **Not used** by Keep My Scale; ADR 0011 rejects seeding a picked title's search from its old score.

### 1.10 Suspect Anchors

**Read.** `keepMyScale.ts:155` `SUSPECT_AFTER = 2`, `163-169` `refreshSuspects`, `175-180` `contradictsAt`, `200-206` `contradictionsOf`. **Only in Keep My Scale.** `contradictsAt(position, answer)` is the one function in the file that already says, for any position, whether an answer agrees with it; `vote` (`383-389`) encodes the same relation again per boundary.

---

## 2. Decisions already recorded

Sources read in full: `GLOSSARY.md`, ADR 0001 to 0012, issues #1, #7, #23, #26, #29, #31, #36, #43, #45, #46, #47, #48, #61 (bodies and comments), and the titles of every issue (#1 to #68). No issue besides #36 and its tickets (#43, #45, #46, #47, #48) and #61 to #67 concerns Anchors, confirmation or the Closer-to prompt. #60 (open, `needs-info`) asks for score ranges per Band and is answered with ADR 0002; it does not touch Keep My Scale's method.

### 2.1 Constraints a replacement has to keep

| # | Constraint | Source |
|---|---|---|
| 1 | **Every answer is checked against the prompt on replay.** "On replay the engine checks that `{a, b}` is exactly the pair it would prompt next; if not, the log is corrupt and replay stops with an error." | ADR 0005 Rules |
| 2 | **Every choice comes from the log and its seed.** "Anchor choice per Duel is deterministic from the log so replay checks prompts" | #43; `hash.ts:1-2`; #23 "Determinism" |
| 3 | **Replay never reads AniList.** The Anchors are one snapshot event. | ADR 0009 Rules; #43 |
| 4 | **Old logs replay under the rule they were answered with.** "A snapshot without it replays under the old rule, so a Ranking started before engine 10 finishes as it was answered" and "The old rule stays in the engine for as long as engine 9 logs are accepted." | ADR 0012; ADR 0005 Consequences ("Changing the insertion algorithm means bumping the engine version and either keeping the old replayer or migrating logs on purpose") |
| 5 | **An Anchor's score is never changed**, Suspect ones included. | GLOSSARY "Anchor", "Suspect Anchor"; ADR 0009; #36 Out of Scope |
| 6 | **Scores come from Anchors only.** A title gets an existing Anchor score, or one human Score Step past the extreme Anchor, shared by every such title, never past the Score Format's ends. | ADR 0009 Rules; #48; `keepMyScale.ts:496-502` |
| 7 | **Every boundary is confirmed**: two different Anchors agree, or 2 of 3. "one drifted Anchor never places a title by itself" | ADR 0009 "Confirmation"; #45; ADR 0012 Rules |
| 8 | **A score with a single Anchor is confirmed against the neighbouring scores.** | ADR 0009; #45 |
| 9 | **The Closer-to prompt is asked once, only for a title strictly between two scores, and its answer settles the title and stands.** | GLOSSARY "Closer-to prompt"; #48; ADR 0012 "A Closer-to answer stands" |
| 10 | **A split on exactly one of the two scores gets that score without the prompt.** | ADR 0012 |
| 11 | **Suspect Anchors**: two contradictions, "Derived during replay, not stored; deterministic so replay prompts still match", and honest Anchors must not become Suspect. | #47; ADR 0009; `keepMyScale.test.ts:827-856` |
| 12 | **Only Settled titles can be imported**; Settled means "more Duels can no longer change its score". | GLOSSARY "Settled"; #36 story 23 |
| 13 | **A picked title's old score plays no part in its Duels**, and a picked title is never an Anchor. | ADR 0011 Rules; #61 stories 33-34 |
| 14 | **The Pool and the Anchors are fixed once the Ranking starts.** | ADR 0011; ADR 0009 |
| 15 | **A title is never settled without a confirmed answer.** With no Anchor left to ask it stays unsettled ("stuck"). | `keepMyScale.ts:250-251`; `keepMyScale.test.ts:534` |
| 16 | **Undo cancels one answer, Closer-to answers included.** | #48; ADR 0005 |
| 17 | **The Duel never shows which side is the Anchor or its score.** | #36 UI decisions; `engine.ts:221-222` |
| 18 | **Duel budget**: "About twice the Duels of a plain binary search over Anchor scores, the price of confirming each boundary." The Picker shows the estimate (#61 story 37) and a test holds the real count to 0.7 to 1.05 of it. | ADR 0009 Consequences; `keepMyScale.test.ts:155-156` |
| 19 | **It has to be explainable.** The probability model was rejected as "hard to explain, replay and tune". | ADR 0009 Considered Options |
| 20 | **Tests go through `replay` only**: "Don't test internal search helpers directly." | #36 Testing Decisions |

**Inferred from 4.** A replacement cannot delete the current rule. `SplitRule` (`keepMyScale.ts:73`) would get a third value, or `anchors-set` a second field, and both existing paths stay until engine 9 and 10 logs are refused. ADR 0010 softens this in practice (a Keep My Scale Ranking is thrown away when its Import finishes, so few such logs are long-lived), but Backups of them exist and one is a test fixture.

### 2.2 Alternatives already considered and rejected

| Alternative | Where | Reason given |
|---|---|---|
| Elo/Glicko with random pairs | ADR 0001 | "it needs far more Duels before the order settles and has no clear end" |
| Bradley-Terry/Elo with Anchor scores as priors | ADR 0009 | "fewer Duels in theory, but hard to explain, replay and tune" |
| New levels between Anchor scores (7.5 between 7 and 8) | ADR 0009 | "this goal is for users who already have a scale, so it should only reuse it" |
| Refresh Anchors on sync | ADR 0009 | "replay would depend on when the sync happened" |
| A picked title's old score as where its search starts | ADR 0011 | "fewer Duels, but the score the user distrusts would steer the result, and the engine would change" |
| Keep a picked scored title as an Anchor for the others | ADR 0011 | "a score that is about to change would be the measure for other titles" |
| Settle on the score at the first win and loss, no third Anchor | ADR 0012 | "one drifted Anchor then places a title by itself"; with 5% of Anchors off by two points "titles a whole score or more off rose from about 2% to about 11%", and Suspect Anchors "were no longer found". It saved "about one Duel per title". |
| Count no contradiction for the Anchors of the split score | ADR 0012 | "only about half as many drifted Anchors are found, and titles a score off roughly double" |
| Only settle a 1-1 split on a score with two Anchors | ADR 0012 | "a title with a win, a loss and a win is still asked" |
| Change replay for every log | ADR 0012 | "a Ranking in progress would stop matching its own answers and fail to load" |
| Random spot-check Duels | ADR 0006 | "caught only about 40% of real misplacements and raised more false alarms than true ones" |
| Answers as free-standing `a > b` facts, no prompt check | ADR 0007 | "rewrites ADR 0001/0005 and loses the check that catches a corrupt log" |
| Random-pivot quickselect over score levels | ADR 0006, 0007 | "saved only 1-18%" |
| A second engine path that saves under 30% | ADR 0007 | "We set a bar of 30% savings before adding a second engine path" |
| Restart an in-progress insertion when its interval changes | ADR 0005 | "throws away answers the user already gave" |
| Build the whole Ranking from old scores with no Duels | ADR 0008 | "equal old scores would make huge Tiers" |

---

## 3. Simulation and measurement

### 3.1 What is in the repo

**Read.**

- **`src/ranking/keepMyScale.test.ts:54-85` `play`** is the only simulated user for Keep My Scale. It knows each picked title's true score, answers a tie when that equals the Anchor's score, takes a `drift` map that makes an Anchor play as another score, and returns the Duel count, every Duel (`met`) and every Closer-to prompt. Run it with `npx vitest run src/ranking/keepMyScale.test.ts` (60 tests, all passing on the working tree, 4.7 s).
- It **asserts bounds and prints nothing**:
  - `keepMyScale.test.ts:132`: Duels at most `2 * n * ceil(log2(2k+1))` with a consistent oracle.
  - `keepMyScale.test.ts:155-156`: total Duels between 0.7 and 1.05 of `estimateKeepMyScaleDuels`.
  - `keepMyScale.test.ts:341`: at most `3 * n * ceil(log2(2k+1))` with drifted Anchors, and every title still on its true score.
  - `keepMyScale.test.ts:852`: Suspect Anchors are exactly the drifted Anchor when it was contradicted twice, never an honest one.
- **Its model of the user is narrow.** Every Anchor of a score has exactly that score's worth unless it is in `drift`; the user ties exactly when the worths are equal; truths are on a score or exactly half a point above one. There is no user who never ties, and no spread between Anchors of one score.
- **The numbers in ADR 0012 cannot be reproduced from the repo.** It quotes "a simulated run" (70-85% of titles asked against 95%, 2% to 3% a score off, 2% to 11% for the rejected option). No file in the repo produces them: nothing outside `src/` imports the engine, and `scripts/` holds only `catchup-eval.ts`.
- **Precedent for a checked-in eval**: `scripts/catchup-eval.ts` with `scripts/catchup-eval/holdout.ts`, run as `npm run eval:catchup` (`package.json`), type-checked by `tsconfig.scripts.json`. It is about Catch-up weights (#44), not ranking, but it is the pattern a ranking simulation would follow.
- For the other Sort Goals the measured numbers live in comments beside the bounds: `scores.test.ts:121` "Measured: about 36% fewer", `estimate.ts:11-14`, `estimate.ts:126-127`, and `oracle.test.ts:117-118` (Full Ranking within 0.95 to 1.1 of `log2(k!)`).

### 3.2 Numbers for Keep My Scale today

**Measured**, with a scratch script that drives the real engine through `replay` exactly as `play` does. It is not in the repo and edits nothing. It lives in this session's scratchpad as `kms-measure.ts` and is run with `node kms-measure.ts "file:///C:/Users/User/Desktop/AniDuel!/src"` (Node 22.19, which runs `.ts` directly as `npm run eval:catchup` does).

**A. The test's own setup** (`keepMyScale.test.ts:136-157`, seed 36, 40 trials, 3 to 10 Anchor scores, 2 to 6 Anchors each, half the titles on a score and half 0.5 above one):

| Titles | Duels | Duels per title | Asked / Start estimate | Against an unconfirmed `log2(2k+1)` search | Closer-to asked |
|---|---|---|---|---|---|
| 367 | 1,876 | 5.11 | 0.921 | 1.39 times | 37.9% of titles |

So confirmation costs about 40% on top of a plain search with this oracle, not the "about twice" of ADR 0009, and the Start estimate is about 8% high.

**B. A fuller user model** (mine, not the repo's): 200 trials of 20 picked titles against 60 Anchors on 7 scores (10 to 4, with 4/9/14/14/9/6/4 Anchors), `POINT_10`, each title's true worth uniform from 3.5 to 10.5. "Off" compares the score given with the true worth. "Spread" gives each Anchor a worth uniform within half a point of its score. "Drift" moves 5% of Anchors two points. The Start estimate here is 6.00 Duels per title.

| User and Anchors | Rule | Duels per title | Closer-to asked | On the nearest score | A whole score or more off | Two or more off | Drifted Anchors found | Honest Anchors made Suspect |
|---|---|---|---|---|---|---|---|---|
| Never ties, no spread, drift | engine 10 | 6.11 | 82.9% | 91.2% | 0.4% | 0% | 127 of 586 (21.7%) | 4 of 11,414 (0.0%) |
| Never ties, no spread, drift | engine 9 | 6.11 | 86.0% | 92.7% | 0.4% | 0% | 21.7% | 0.0% |
| Never ties, no spread, no drift | engine 10 | 6.00 | 85.7% | 92.7% | 0.0% | 0% | none to find | 0 of 12,000 |
| Never ties, spread, drift | engine 10 | 6.42 | 61.3% | 91.3% | 2.1% | 0% | 100 of 586 (17.1%) | 125 of 11,414 (1.1%) |
| Never ties, spread, drift | engine 9 | 6.42 | 85.6% | 92.5% | 2.0% | 0% | 17.1% | 1.1% |
| Ties within 0.25, spread, drift | engine 10 | 6.26 | 41.0% | 92.7% | 0.7% | 0% | 147 of 586 (25.1%) | 267 of 11,414 (2.3%) |
| Ties within 0.25, spread, no drift | engine 10 | 6.16 | 42.3% | 94.1% | 0.1% | 0% | none to find | 285 of 12,000 (2.4%) |

What these say (**Inferred** from the table):

- **Duels are already near the estimate** and barely move with the user model: 6.0 to 6.4 per title against an estimate of 6.0.
- **Accuracy is already high**: 91% to 94% on the nearest score, at most 2.1% a whole score off, none two off. A replacement has little accuracy left to win; what is left to win is Duels and prompts.
- **The Closer-to prompt is the visible cost**, and it depends on the user more than on the rule: 41% for a user who ties within a quarter point, 61% to 83% for one who never does.
- **ADR 0012's effect shows up only when Anchors of one score differ in worth** (61% against 86%). With every Anchor of a score identical, a title can hardly be split, and the rule changes little (83% against 86%). The repo's oracle is that identical-Anchor case.
- **Honest Anchors do become Suspect once Anchors of a score are not identical**: 1.1% to 2.4% of them, with no drift at all in the last row. `keepMyScale.test.ts:852` asserts this never happens, but only under the identical-Anchor model.
- **Only about one drifted Anchor in five is found**, because an Anchor has to be met by two titles that settle against it.

These rows are the baseline a proposed rule has to be run against, on the same seeds. The ranges differ from ADR 0012's (its run and parameters are not recorded), so the two should not be compared number for number.

---

## 4. What a simpler or more accurate method could look like, from existing patterns only

Everything in this section is **Inferred**. None of it has been run. Each option changes which Duel is asked or what an answer decides, so each one needs engine 11 and a rule name in `anchors-set` (constraint 4), and each has to be measured on the rows of section 3.2 before it is offered.

### Where the complexity is today

- The search (`openLevels`, `nextLevel`): about 25 lines, a copy of binary insertion.
- The voting (`voterLevels`, `nextVoter`, `vote`, `decide`, `range`): about 110 lines.
- Splits and contradictions (`splitOn`, `contradictsAt`, `contradictionsOf`, `refreshSuspects`): about 60 lines.
- State that is stored and derived at once (`Placement.lo/hi`, `closer`, `contradicts`), section 1.2.

### Option A: Anchor levels as Tiers, on the Full Ranking insertion

Seed one Segment with a Tier per Anchor level and let the existing insertion place picked titles.

- **Builds on**: `Insertion` and `Segment` (`engine.ts:434-440`), `insertionInterval` (`engine.ts:497-501`), the middle pivot (`engine.ts:1077`), `removeTier` for a level with no Anchor left (`engine.ts:533-540`), `intervalOf` (`levelSelect.ts:44-50`). An empty interval is the gap that today leads to the Closer-to prompt.
- **For**: removes the `2k+1` encoding and the second copy of the search; bounds that survive removals are already solved (ADR 0005 "An insertion in progress keeps what it knows").
- **Against**: the Tier engine moves a bound on one answer (`engine.ts:638-639`) and ends on one tie (`engine.ts:634`), so every part of confirmation still has to be added, including the neighbour votes for a single-Anchor level, which have no counterpart there. A picked title must not join an Anchor Tier where it could become a pivot's face (constraint 13). `Machine.bands` assumes five Bands.
- **Net**: a refactor of the 25 lines that are already simple. Accuracy and Duels unchanged.

### Option B: derive the standing from all answers, the way `levelSelect.ts` does

One pure function from the answers that count to a standing, with nothing stored but the answers.

- **Builds on**: `contradictsAt` (`keepMyScale.ts:175-180`), `counted` (`keepMyScale.ts:183-185`), the stateless shape of `knowledgeOf` (`levelSelect.ts:89-119`), and its definition of settled (`levelSelect.ts:110`). For each position `p` in `0..2k`, count the counted answers that contradict `p`. The open positions are those not yet beaten by two. The next Duel is chosen as today (`nextLevel`, `nextVoter`).
- **Why confirmation survives**: a level's own position and the gap above it differ only in answers against that level's Anchors (a tie favours the level, a win favours the gap, a loss rules out both). So "ahead by two" between neighbouring positions is the same test as "two agreeing Anchors" today.
- **For**: `vote`, `decide`, `range` and `contradictionsOf` collapse into one tally. Neighbour votes come for free. Answer order stops mattering (today "a decided boundary is never reopened", `keepMyScale.ts:439`; ADR 0012 mentions "the answer-order effect"). A Suspect or Forgotten Anchor is handled by `counted` alone.
- **Against**:
  - It does not help the user who never ties. A win and a loss against one level leave that level with two contradictions and the gaps on either side with one each, so the level is the worst of the three. ADR 0012's split rule has to stay as an explicit rule, or wins and losses against a level have to count for less than a full contradiction, which is a weight to tune (constraint 19).
  - Two wins and a loss put the gap above ahead of the gap below by one, not two. Today 2 of 3 decides (`keepMyScale.ts:405-406`). A plain "ahead by two" would ask a fourth Anchor, so the stopping rule needs the same "two on a side and more than the other" wording, and the Duel count has to be measured.
  - Boundaries can reopen, so a title can leave Settled more often than today. ADR 0012 already accepts this for Suspect Anchors ("A settled title can become unsettled again").
  - ADR 0007 rejected "answers as free-standing facts" only where the prompt check was dropped. Here the prompt is still derived and checked, so constraint 1 holds.
- **Net**: simpler to read, accuracy probably equal. Duels unknown.

### Option C: start the search where the Anchors are, as Scores does

Keep every rule, change only `openLevels` (`keepMyScale.ts:299-305`) to pick the open level holding the median usable Anchor in place of the middle level by index.

- **Builds on**: `towardsPivot` (`levelSelect.ts:171-181`) and ADR 0007's "search weighted by group size"; Anchor counts from `usable` (`keepMyScale.ts:324-326`).
- **For**: a few lines. It uses Anchor counts, not the picked title's old score, so ADR 0011's rejection does not apply. A level with many Anchors can always confirm itself without neighbours.
- **Against**: the gain is small unless the list is very lopsided. For 4/9/14/14/9/6/4 Anchors the entropy is about 2.65 bits against `log2(7)` = 2.81, about 5% fewer steps, and only if picked titles fall on scores in the proportion the Anchors do. That is far below the 30% bar ADR 0007 set for a second engine path.
- **Net**: cheap and safe, probably not worth an engine version by itself.

### Option D: let consistent answers confirm each other by transitivity

Today each step of the search waits for two Anchors of the same level (`decide` counts neighbours "only once every usable Anchor of the own level has answered", `keepMyScale.ts:393-395`). A title that lost to a 7 and then lost to a 5 already has two different Anchors agreeing it is below 7.

- **Builds on**: the transitivity the Tier engine relies on ("which is still true by transitivity", `engine.ts:532`; ADR 0005) and `vote`'s neighbour cases (`keepMyScale.ts:387-388`), extended from the two neighbouring levels (`voterLevels`, `keepMyScale.ts:335-340`) to any level. It needs option B's tally, because the search must be able to back out when the Anchors around the final place disagree with the path that led there.
- **For**: only the two boundaries around the final place would need two Anchors of their own level. A rough expectation is `log2(k)` plus two or three Duels where today it is `2 * log2(k+1)`, so about 4.5 to 5 Duels per title on 7 scores against 6.1. This is the only option here with a Duel saving near ADR 0007's bar.
- **Against**:
  - It is the option nearest the rule ADR 0012 was written to protect. The letter of ADR 0009 holds ("A boundary is passed only when two different Anchors agree"), and no single Anchor places a title, because the final place still needs two own-level votes on each side. Whether that is enough is for the simulation and the user to say, not for this note.
  - Each Anchor is met less often, so fewer drifted Anchors would be found. ADR 0012's first rejected option failed on exactly that ("Suspect Anchors were no longer found"), and today's rate is already only about 20% (section 3.2).
  - A wrong early answer costs extra Duels to back out of.
- **Net**: the only real saving, with the highest risk. It must come with the section 3.2 numbers (Duels, prompts, titles off, drifted Anchors found, honest Anchors made Suspect) for both rules side by side.

### Not an algorithm change

- **Ties are the cheapest route to a score.** Section 3.2: 41% of titles are asked the Closer-to prompt when the user ties within a quarter point, 61% to 83% when they never do. The hesitation nudge (`src/ui/duel/hesitation.ts`) already pushes towards "About the same" after 20 s and needs no engine version.
- **A checked-in simulation is missing.** Both ADR 0012 and this note had to measure with throwaway scripts. A script beside `scripts/catchup-eval.ts`, with a user who may never tie and Anchors that differ within a score, would make the next rule change comparable with this one.
- **The Start estimate** (`src/pool/anchors.ts:81-83`) is about 8% high on the test's setup and exact on the 7-score setup; it is not a reason to change anything.
