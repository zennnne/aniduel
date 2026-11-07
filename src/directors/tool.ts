// Top Directors as an AniLyze tool: its wording and the Director Score's numbers, option B of the Director research
// (docs/research/top-director-score.md §5, chosen by the owner): Directors have about half a studio's Votes, so the
// Gate and k are scaled by that ratio and the Label margin is wider.
import type { Tool } from '../anilyze/tool.ts'

/** Pseudo-votes at the user's average every Director starts with: "a Director needs this much evidence". */
export const K = 6
/** Votes a Director needs to be ranked. */
export const GATE = 4
/** A short list lowers the gate one Vote at a time until this many Directors rank... */
export const GATE_TARGET = 10
/** ...but never below this. */
export const GATE_FLOOR = 3

export const TOP_DIRECTORS: Tool = {
  words: {
    name: 'Top Directors',
    one: 'director',
    many: 'directors',
    score: 'Director Score',
    intro:
      'Type an AniList username to see which anime directors they really like, from their scores, drops, rewatches and favourites.',
    reading: "Reading every title's staff credits, then weighing every score. A long list takes a while: about 7 seconds per 500 titles.",
  },
  scoring: {
    gate: { start: GATE, target: GATE_TARGET, floor: GATE_FLOOR },
    k: K,
    // Labels compare a Director's rates with the top 20 ranked Directors', high only 10 points above theirs.
    labels: { pool: 20, margin: 0.1 },
  },
  crossLink: { tool: 'studios', text: '🏢 Top Studios →' },
}
