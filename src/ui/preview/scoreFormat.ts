import type { ScoreFormat } from '../../anilist/types.ts'

/** How the app names each Score Format to the user. */
export const SCORE_FORMAT_LABEL: Record<ScoreFormat, string> = {
  POINT_100: '100 point',
  POINT_10_DECIMAL: '10 point decimal',
  POINT_10: '10 point',
  POINT_5: '5 stars',
  POINT_3: '3 smileys',
}
