# Bands decide order only; the Distribution decides scores

Rough Sort puts every title into one of 5 fixed Bands so that Duels only happen inside a Band. This cuts a full sort of 200 titles from about 1,300 Duels to about 800. Bands are fixed boundaries in the Ranking, but they are **not** score ranges: scores come from applying the Distribution (Linear or Bell) to the whole Ranking. When a title's score falls outside what its Band suggests, the preview warns the user and lets them fix it.

We chose this because the target user is a beginner who tends to put most titles in the top Band. A well-spread Distribution is the main value of the app, and Bands exist to save Duels, not to fix scores.

## Considered Options

- **Each Band is a fixed score range**: this respects the user's Rough Sort exactly, and users on 3 smileys would need no Duels at all. We rejected it because the Distribution would stop meaning anything, since the shape of the scores would just follow the Band sizes.
- **Number of Bands follows the Score Format**: we dropped this once Bands stopped being score ranges. There are always 5 Bands now.

## Consequences

- A title can only move across a Band boundary through the explicit "move Band" action, which takes that title out of the Ranking and inserts it again in the new Band. Earlier Duel answers stay in the log (ADR 0005).
