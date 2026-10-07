// The Board as the last check after Rough Sort (ADR 0008).
import type { RankingState } from '../../ranking/engine.ts'

/**
 * Whether the last-check Board shows now, in place of the Band choice, a Duel or the finished Ranking: Rough Sort
 * is done, the Board is still open (no Duel answer in effect), and the user hasn't pressed Continue yet.
 * `continued` is session UI state only (not a log event), so a reload before the first Duel answer shows it again.
 */
export function lastCheckDue(state: RankingState, continued: boolean): boolean {
  return state.board.open && state.prompt.kind !== 'rough-sort' && !continued
}
