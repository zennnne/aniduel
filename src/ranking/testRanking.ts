// Test helper (not used by the app): a finished Ranking built through the real engine.
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent, type RankingState } from './engine.ts'

/**
 * `bands[b]` lists that Band's Tiers best first, by title id. Duels are answered by an oracle that knows that
 * order (same Tier = "about the same"). `forgotten` titles are added too and marked Forgotten in Rough Sort.
 */
export function rankingOf(bands: number[][][], forgotten: number[] = []): RankingState {
  const ids = [...forgotten, ...bands.flat(2)]
  const value = new Map<number, number>()
  bands.forEach((tiers) => tiers.forEach((tier, i) => tier.forEach((id) => value.set(id, -i))))
  const bandOf = new Map<number, BandIndex>()
  bands.forEach((tiers, b) => tiers.flat().forEach((id) => bandOf.set(id, b as BandIndex)))
  let log: DuelLog = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids })
  const add = (e: LogEvent) => (log = { ...log, events: [...log.events, e] })
  forgotten.forEach((id) => add({ type: 'forgotten', id }))
  bands.flat(2).forEach((id) => add({ type: 'band-assigned', id, band: bandOf.get(id)! }))
  for (let s = replay(log); s.prompt.kind !== 'all-complete'; s = replay(log)) {
    const p = s.prompt
    if (p.kind !== 'duel') throw new Error(`unexpected ${p.kind}`)
    const va = value.get(p.a)!
    const vb = value.get(p.b)!
    add({ type: 'duel-answered', a: p.a, b: p.b, result: va === vb ? 'tie' : va > vb ? 'a' : 'b' })
  }
  return replay(log)
}
