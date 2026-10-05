// Shapes the rest of the app sees from AniList. Kept free of GraphQL details.

export type MediaType = 'ANIME' | 'MANGA'

export type ListStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING'

export type ScoreFormat = 'POINT_100' | 'POINT_10_DECIMAL' | 'POINT_10' | 'POINT_5' | 'POINT_3'

export type TitleLanguage =
  | 'ROMAJI'
  | 'ENGLISH'
  | 'NATIVE'
  | 'ROMAJI_STYLISED'
  | 'ENGLISH_STYLISED'
  | 'NATIVE_STYLISED'

export type Viewer = {
  id: number
  name: string
  avatarUrl: string | null
  titleLanguage: TitleLanguage
  scoreFormat: ScoreFormat
}

export type Title = { romaji: string; english: string | null; native: string | null }

export type FuzzyDate = { year: number | null; month: number | null; day: number | null }

/** One title on the user's list, with the display data later screens need. */
export type ListEntry = {
  mediaId: number
  status: ListStatus
  /** The user's current AniList score on the 100-point scale; 0 means no score. */
  oldScore100: number
  completedAt: FuzzyDate
  title: Title
  coverUrl: string | null
  coverColor: string | null
  bannerUrl: string | null
  year: number | null
  format: string | null
  /** Episodes for anime, chapters for manga. */
  length: number | null
  siteUrl: string
}

export type RateLimit = { remaining: number | null; resetAt: number | null }
