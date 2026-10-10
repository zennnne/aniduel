import { count } from '../meta.ts'

/**
 * The unsettled card's summary on Preview (#29). Titles get unsettled by a settings change, Forgotten, a sync, a Band
 * move or a Re-rank, so the copy names no cause.
 */
export function unsettledSummary(titles: number, refineDuels: number): string {
  return `${count(titles, 'title')} not settled yet · about ${count(refineDuels, 'Refine Duel')}`
}

/**
 * The same card under Score New Titles (ADR 0009): `asking` while the engine still has a question for some title.
 * Without one, every Anchor the unsettled titles could still be compared with is Forgotten or Suspect.
 */
export function newTitlesUnsettledSummary(titles: number, asking: boolean): string {
  if (asking) return `${count(titles, 'title')} not settled yet · a few more Duels decide`
  const them = titles === 1 ? 'it' : 'them'
  return `${count(titles, 'title')} not settled · no Anchor left to compare ${them} with · Bring back a Forgotten Anchor to go on`
}
