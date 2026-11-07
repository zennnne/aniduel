// What makes one AniLyze tool its own: its wording and the scoring numbers research set for it. The shared views and
// components take a Tool; Top Studios passes TOP_STUDIOS (src/studios/tool.ts), Top Directors its own.
import type { ScoringParams } from './scoring.ts'

/** AniLyze's tools by page name, each a page under /aniduel/anilyze/ (src/sitePages.ts). */
export type ToolName = 'studios' | 'directors'

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

/** The other AniLyze tool, linked from the dark header with the same `?user=` (#99's L1): "🎬 Top Directors →". */
export type CrossLink = { tool: ToolName; text: string }

export type Tool = { words: ToolWords; scoring: ScoringParams; crossLink: CrossLink }

/** "studio" or "studios" for this count. */
export const countOf = (words: ToolWords, n: number) => (n === 1 ? words.one : words.many)

/** "Studios" from "studios": the word as it starts a heading. */
export const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
