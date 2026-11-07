// Top Studios as an AniLyze tool: its wording and Studio Score v2.8's numbers for studios.
import type { Tool } from '../anilyze/tool.ts'

/** Pseudo-votes at the user's average every studio starts with: "a studio needs this much evidence". */
export const K = 13.1
/** Votes a studio needs to be ranked. */
export const GATE = 6
/** A short list lowers the gate one Vote at a time until this many studios rank... */
export const GATE_TARGET = 10
/** ...but never below this. */
const GATE_FLOOR = 4

export const TOP_STUDIOS: Tool = {
  words: {
    name: 'Top Studios',
    one: 'studio',
    many: 'studios',
    score: 'Studio Score',
    intro:
      'Type an AniList username to see which animation studios they really like, from their scores, drops, rewatches and favourites.',
    reading: 'Counting studios, weighing every score. A long list takes a few seconds.',
  },
  scoring: {
    gate: { start: GATE, target: GATE_TARGET, floor: GATE_FLOOR },
    k: K,
    // Labels compare a studio's rates with the top 20 ranked studios', high only 6 points above theirs.
    labels: { pool: 20, margin: 0.06 },
  },
}
