// What makes one AniLyze tool its own: its wording and the scoring numbers research set for it. The shared views and
// components take a Tool; Top Studios passes TOP_STUDIOS (src/studios/tool.ts), Top Directors its own.
import type { ScoringParams } from './scoring.ts'

export type ToolWords = {
  /** The tool's name: "Top Studios". */
  name: string
  /** One of who it ranks, in a sentence: "studio". */
  one: string
  /** Several: "studios". */
  many: string
  /** The number it ranks by: "Studio Score". */
  score: string
  /** The search page's line before a lookup. */
  intro: string
  /** The search page's line while a list loads. */
  reading: string
}

export type Tool = { words: ToolWords; scoring: ScoringParams }

/** "studio" or "studios" for this count. */
export const countOf = (words: ToolWords, n: number) => (n === 1 ? words.one : words.many)

/** "Studios" from "studios": the word as it starts a heading. */
export const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
