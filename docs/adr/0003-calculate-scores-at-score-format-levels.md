# Calculate scores at the user's Score Format levels, not as continuous 0-100

The obvious approach is to send `scoreRaw` (0-100) and let AniList convert it to the user's Score Format. We don't do that. We read the user's `scoreFormat`, calculate each score at the levels of that format, and send a `scoreRaw` that matches one of those levels exactly. We tested AniList's conversion on 2026-10-05: POINT_10 always rounds down (raw 79 shows as 7), POINT_5 rounds to the nearest star, and POINT_3 uses thresholds that aren't documented. Any of these would make the preview show different scores from what ends up on AniList.

## Consequences

- The user's best and worst scores must be levels of their format, and the worst can never be 0, because raw 0 means "no score" on AniList.
- If the user changes their Score Format on AniList in the middle of a Ranking, the scores must be recalculated before Import.
