// Holdout eval for the Catch-up weights (#44). Usage: node scripts/catchup-eval.ts [--seed N] user1 user2 ...
// Fetches each public AniList anime list (no login), hides 20% of the watched titles and prints a Markdown table of
// how many each weight variant brings into the batch of 20. Progress goes to stderr, the table to stdout.
import { runEval } from './catchup-eval/holdout.ts'

const args = process.argv.slice(2)
let seed = 44
const seedAt = args.indexOf('--seed')
if (seedAt !== -1) {
  seed = Number(args[seedAt + 1])
  args.splice(seedAt, 2)
}
if (args.length === 0 || !Number.isInteger(seed)) {
  console.error('Usage: node scripts/catchup-eval.ts [--seed N] <AniList user name> [more user names...]')
  process.exit(1)
}

const table = await runEval(
  {
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (line) => console.error(line),
  },
  args,
  seed,
)
console.log(table)
