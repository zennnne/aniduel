// Simulated-user eval for Keep My Scale. Usage: node scripts/keep-my-scale-eval.ts [--seeds N] [--rule closer-to|on-the-score]
// Prints a Markdown table of Duels, placement and Suspect Anchors for made-up Anchor lists and users (see
// keep-my-scale-eval/sim.ts for the model). Run it before and after a change to a placement rule. Progress goes to
// stderr, the table to stdout.
import { runEval } from './keep-my-scale-eval/sim.ts'

const args = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args.splice(at, 2)[1]
}
const seeds = Number(option('--seeds') ?? 20)
const rule = option('--rule') ?? 'on-the-score'
if (args.length > 0 || !Number.isInteger(seeds) || seeds < 1 || (rule !== 'closer-to' && rule !== 'on-the-score')) {
  console.error('Usage: node scripts/keep-my-scale-eval.ts [--seeds N] [--rule closer-to|on-the-score]')
  process.exit(1)
}

console.log(runEval(seeds, rule, (line) => console.error(line)))
