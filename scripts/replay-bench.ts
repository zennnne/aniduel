// What one answer costs as the Duel log grows. Usage: node scripts/replay-bench.ts [--titles N] [--goal full-ranking|scores] [--duels N]
// A made-up user sorts N titles into the five Bands and answers Duels from a hidden order. Every 1000 events it prints
// the time of an answer through `replayer` (what the app does), of a replay from the start (opening the Ranking, an
// Undo) and of writing the log as JSON. Run it before and after a change to replay.
import { appendEvent, replay, replayer, startLog, type BandIndex, type LogEvent } from '../src/ranking/engine.ts'

const args = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args.splice(at, 2)[1]
}
const titles = Number(option('--titles') ?? 1500)
const goal = option('--goal') ?? 'scores'
const maxDuels = Number(option('--duels') ?? Infinity)
if (args.length > 0 || !Number.isInteger(titles) || titles < 1 || Number.isNaN(maxDuels) || (goal !== 'full-ranking' && goal !== 'scores')) {
  console.error('Usage: node scripts/replay-bench.ts [--titles N] [--goal full-ranking|scores] [--duels N]')
  process.exit(1)
}

// The hidden order: a seeded shuffle, so every run answers the same Duels.
let s = 12345
const random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff)
const ids = Array.from({ length: titles }, (_, i) => i + 1)
const value = new Map<number, number>()
ids
  .map((id) => ({ id, at: random() }))
  .sort((x, y) => x.at - y.at)
  .forEach(({ id }, i) => value.set(id, titles - i))
const bandOf = (id: number) => Math.min(4, Math.floor(((titles - value.get(id)!) / titles) * 5)) as BandIndex

const ms = (run: () => unknown): number => {
  const start = performance.now()
  run()
  return performance.now() - start
}

let log = startLog({ seed: 1, userId: 7, mediaType: 'ANIME', ids, ...(goal === 'scores' && { scoreFormat: 'POINT_10' as const }) })
const live = replayer()
let state = live(log)
let duels = 0
let answers = 0
let answering = 0

function report(): void {
  const fromStart = Math.min(...[0, 1, 2].map(() => ms(() => replay(log))))
  const json = ms(() => JSON.stringify(log))
  console.log(`| ${log.events.length} | ${duels} | ${(answering / answers).toFixed(3)} | ${fromStart.toFixed(1)} | ${json.toFixed(1)} |`)
  answers = answering = 0
}

console.log(`${titles} titles, ${goal}`)
console.log('| events | Duels | answer (ms) | replay from the start (ms) | JSON (ms) |')
console.log('|---|---|---|---|---|')
while (state.prompt.kind !== 'all-complete' && duels < maxDuels) {
  const p = state.prompt
  let event: LogEvent
  if (p.kind === 'rough-sort') event = { type: 'band-assigned', id: p.id, band: bandOf(p.id) }
  else if (p.kind !== 'duel') throw new Error(`unexpected prompt ${p.kind}`)
  else if (state.bandChoice) event = { type: 'band-selected', band: state.bandChoice.next }
  else {
    event = { type: 'duel-answered', a: p.a, b: p.b, result: value.get(p.a)! > value.get(p.b)! ? 'a' : 'b' }
    duels++
  }
  log = appendEvent(log, event)
  answering += ms(() => (state = live(log)))
  answers++
  if (log.events.length % 1000 === 0) report()
}
if (answers > 0) report()
