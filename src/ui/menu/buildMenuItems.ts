import type { ListStatus, MediaType } from '../../anilist/types.ts'
import type { BandIndex, RankingState, SortGoal } from '../../ranking/engine.ts'
import { fullRankingExtra } from '../../ranking/estimate.ts'
import { isScores } from '../../ranking/sortGoal.ts'
import { titlesToSort } from '../../ranking/split.ts'
import { BAND_UI } from '../bands.ts'
import { MEDIA_LABEL } from '../meta.ts'
import { statusLabel } from '../start/statusLabel.ts'
import type { MenuItem } from './menuItems.ts'

/** What the menu depends on: the open Ranking and where the user is. */
export type MenuContext = {
  mediaType: MediaType
  statuses: readonly ListStatus[]
  /** A usable Duel log is open (there is something to back up). */
  hasLog: boolean
  /** Saved progress exists, usable or not (Start over can throw it away). */
  hasProgress: boolean
  ranking: RankingState | null
  /** The Band choice is showing. */
  choosingBand: boolean
  /** Bands that qualify for a split now (ADR 0006). */
  splitOffers: readonly BandIndex[]
  /** Titles Catch-up hides now because they were Passed within 30 days (#50). */
  passedHidden?: number
}

export type MenuActions = {
  switchMediaType: (type: MediaType) => void
  changeStatuses: () => void
  saveBackup: () => void
  chooseBand: () => void
  splitBand: (band: BandIndex) => void
  /** During Rough Sort, the Board; after it, the last check again. */
  openBoard: () => void
  restore: () => void
  startOver: () => void
  toggleTheme: () => void
  logout: () => void
  /** Switch the open Ranking to this Sort Goal (#28): Full Ranking asks first, Scores switches at once. */
  switchSortGoal: (goal: SortGoal) => void
  /** Catch-up (anime only), whichever Media Type the open Ranking is. */
  openCatchUp: () => void
  /** Asks before emptying Catch-up's Passed history. */
  clearPassed: () => void
}

/** The one list behind the account menu and the Ctrl+K palette, for a logged-in user. */
export function buildMenuItems(context: MenuContext, actions: MenuActions): MenuItem[] {
  const { mediaType, statuses, ranking } = context
  const other: MediaType = mediaType === 'ANIME' ? 'MANGA' : 'ANIME'
  const items: MenuItem[] = [
    {
      id: 'switch-media-type',
      group: 'This Ranking',
      icon: '⇆',
      title: `Switch to ${MEDIA_LABEL[other]}`,
      description: 'Each Media Type keeps its own Ranking',
      run: () => actions.switchMediaType(other),
    },
    {
      id: 'statuses',
      group: 'This Ranking',
      icon: '☰',
      title: 'Change list statuses',
      description: `${statuses.map((st) => statusLabel(st, mediaType)).join(', ')} · titles join or leave the Ranking`,
      run: actions.changeStatuses,
    },
  ]
  // Any Ranking can switch, older ones (on Full Ranking, without a Sort Goal) too, but nobody is told (#23).
  if (context.hasLog && ranking) {
    const toFull = isScores(ranking)
    items.push({
      id: 'sort-goal',
      group: 'This Ranking',
      icon: '◎',
      title: `Switch to ${toFull ? 'Full Ranking' : 'Scores'}`,
      description: toFull
        ? `Every title gets its own place · about +${fullRankingExtra(ranking)} Duels`
        : 'Stop once every score is settled · fewer Duels',
      run: () => actions.switchSortGoal(toFull ? 'full-ranking' : 'scores'),
    })
  }
  if (context.hasLog) {
    items.push({
      id: 'backup',
      group: 'This Ranking',
      icon: '↓',
      title: 'Save Backup file',
      description: 'Download your Duel log and settings',
      run: actions.saveBackup,
    })
  }
  // The Board is open only before the first Duel answer: after that, Move in the Duel screen changes a Band.
  if (ranking?.board.open) {
    items.push({
      id: 'board',
      group: 'This Ranking',
      icon: '▦',
      title: 'Open the Board',
      description: 'Every title by Band · moves are free until your first Duel',
      run: actions.openBoard,
    })
  }
  if (ranking?.prompt.kind === 'duel' && !ranking.bandChoice && !context.choosingBand) {
    items.push({
      id: 'choose-band',
      group: 'This Ranking',
      icon: '▤',
      title: 'Choose a Band',
      description: 'Pick which Band to Duel in next',
      run: actions.chooseBand,
    })
  }
  // Split offers after Rough Sort, under the same rule as the automatic offer (ADR 0006).
  if (ranking && ranking.prompt.kind !== 'rough-sort') {
    for (const band of context.splitOffers) {
      items.push({
        id: `split-band-${band}`,
        group: 'This Ranking',
        icon: '⫼',
        title: `Split ${BAND_UI[band].label} into Sub-bands`,
        description: `${titlesToSort(ranking, band)} titles ${isScores(ranking) ? 'not settled' : 'without a place'}: Best / Middle / Lowest cuts the Duels`,
        run: () => actions.splitBand(band),
      })
    }
  }
  items.push({
    id: 'restore',
    group: 'This Ranking',
    icon: '↑',
    title: 'Restore from Backup',
    description: 'Load a Backup file from another browser',
    run: actions.restore,
  })
  if (context.hasProgress) {
    items.push({
      id: 'start-over',
      group: 'This Ranking',
      icon: '↺',
      title: 'Start this Ranking over',
      description: `Throws away all Duels for ${MEDIA_LABEL[mediaType]}`,
      danger: true,
      run: actions.startOver,
    })
  }
  items.push(
    {
      id: 'catch-up',
      group: 'App',
      icon: '+',
      title: 'Catch-up',
      description: 'Add anime you’ve already watched, 20 at a time',
      run: actions.openCatchUp,
    },
  )
  if (context.passedHidden) {
    items.push({
      id: 'clear-passed',
      group: 'App',
      icon: '⌫',
      title: 'Clear Catch-up’s Passed list',
      description: `${context.passedHidden} ${context.passedHidden === 1 ? 'title' : 'titles'} hidden · they come back in the next batch`,
      run: actions.clearPassed,
    })
  }
  items.push(
    {
      id: 'theme',
      group: 'App',
      icon: '◐',
      title: 'Light / dark theme',
      description: 'Follows your system unless you pick one',
      run: actions.toggleTheme,
    },
    {
      id: 'logout',
      group: 'Account',
      icon: '⎋',
      title: 'Log out',
      description: 'Removes your AniList token from this browser',
      run: actions.logout,
    },
  )
  return items
}
