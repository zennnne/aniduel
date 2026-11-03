// Holdout eval for the Catch-up weights (#44; manga #96). Usage: node scripts/catchup-eval.ts [--manga] [--seed N] user1 ...
// Fetches each public AniList list (no login), hides 20% of the watched titles and prints a Markdown table of how many
// each weight variant brings into the batch of 20. With --manga it reads the manga lists, feeds the anime lists in as
// the anime signal, and adds the near-empty threshold table. Progress goes to stderr, the tables to stdout.
import { runEval } from './catchup-eval/holdout.ts'
import { runMangaEval } from './catchup-eval/manga.ts'

const args = process.argv.slice(2)
let seed = 44
const mangaAt = args.indexOf('--manga')
const manga = mangaAt !== -1
if (manga) args.splice(mangaAt, 1)
const seedAt = args.indexOf('--seed')
if (seedAt !== -1) {
  seed = Number(args[seedAt + 1])
  args.splice(seedAt, 2)
}
if (args.length === 0 || !Number.isInteger(seed)) {
  console.error('Usage: node scripts/catchup-eval.ts [--manga] [--seed N] <AniList user name> [more user names...]')
  process.exit(1)
}

const deps = {
  fetch: globalThis.fetch,
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: (line: string) => console.error(line),
}
const table = manga ? await runMangaEval(deps, args, seed) : await runEval(deps, args, seed)
console.log(table)
