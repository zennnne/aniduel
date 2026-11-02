// Parity check for Top Studios (#90): the TypeScript port against the Python prototype at v2.7.
// Usage: node scripts/top-studio-parity.ts [--cache <dir>] [user ...]
// Reads the prototype's AniList caches (list_<user>.json, favs_<user>.json; default scripts/top-studio-score, every user
// cached there), feeds each through a fake AniList into loadTopStudios, runs prototype.py --json on the same caches and
// compares. Ranks, labels, gate and watchlist must match exactly, S within 1e-6. Exits 1 on any difference.
// The caches hold other people's lists: they are gitignored and never committed. Needs `python` (or $PYTHON) on PATH.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTopStudios, type StudioScore, type TopStudios } from '../src/studios/loadTopStudios.ts'

const S_TOLERANCE = 1e-6
const PROTOTYPE_DIR = fileURLToPath(new URL('./top-studio-score/', import.meta.url))

const LABEL_NAMES: Record<StudioScore['label'], string> = {
  elite: 'Elite',
  bold: 'Bold',
  reliable: 'Reliable',
  meh: 'Meh',
}

type PythonStudio = { name: string; S: number; n: number; hit: number; flop: number; tag: string }
type PythonResult = { user: string; gate: number; u_bar: number; ranked: PythonStudio[]; watchlist: PythonStudio[] }

const args = process.argv.slice(2)
let cacheDir = PROTOTYPE_DIR
const cacheAt = args.indexOf('--cache')
if (cacheAt !== -1) {
  cacheDir = args[cacheAt + 1]
  args.splice(cacheAt, 2)
}
const users = args.length
  ? args
  : readdirSync(cacheDir)
      .map((f) => /^list_(.+)\.json$/.exec(f)?.[1])
      .filter((u): u is string => Boolean(u))
if (users.length === 0) {
  console.error(`No cached users (list_<user>.json) in ${cacheDir}. Run prototype.py <user> there first.`)
  process.exit(1)
}

/** A fake AniList that answers the Top Studios queries from the prototype's caches: one list chunk, favourites by 25. */
function cachedAniList(user: string): typeof fetch {
  const entries: unknown[] = JSON.parse(readFileSync(join(cacheDir, `list_${user}.json`), 'utf8'))
  const favourites: Array<{ id: number }> = JSON.parse(readFileSync(join(cacheDir, `favs_${user}.json`), 'utf8')).anime
  const answer = (data: unknown) =>
    new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const { query, variables } = JSON.parse(String(init?.body))
    if (variables.userName !== user) throw new Error(`asked for ${variables.userName}, not ${user}`)
    if (query.includes('MediaListCollection')) {
      return answer({ MediaListCollection: { hasNextChunk: false, lists: [{ entries }] } })
    }
    const page: number = variables.page
    const nodes = favourites.slice((page - 1) * 25, page * 25)
    return answer({ User: { favourites: { anime: { pageInfo: { hasNextPage: page * 25 < favourites.length }, nodes } } } })
  }) as typeof fetch
}

function runPrototype(user: string): PythonResult {
  const out = execFileSync(
    process.env.PYTHON ?? 'python',
    ['-I', join(PROTOTYPE_DIR, 'prototype.py'), user, '--json', `--cache=${cacheDir}`],
    { encoding: 'utf8' },
  )
  return JSON.parse(out)
}

/** The differences between one list of studios on both sides, as lines; empty when they match. */
function compareStudios(what: string, ts: StudioScore[], py: PythonStudio[]): { problems: string[]; maxDiff: number } {
  const problems: string[] = []
  let maxDiff = 0
  if (ts.length !== py.length) problems.push(`${what}: ${ts.length} studios in TS, ${py.length} in Python`)
  for (let i = 0; i < Math.min(ts.length, py.length); i++) {
    const [t, p] = [ts[i], py[i]]
    const at = `${what} #${i + 1}`
    if (t.name !== p.name) problems.push(`${at}: ${t.name} in TS, ${p.name} in Python`)
    if (LABEL_NAMES[t.label] !== p.tag) problems.push(`${at} ${t.name}: ${LABEL_NAMES[t.label]} in TS, ${p.tag} in Python`)
    if (t.votes.length !== p.n) problems.push(`${at} ${t.name}: ${t.votes.length} entries in TS, ${p.n} in Python`)
    const diff = Math.abs(t.score - p.S)
    maxDiff = Math.max(maxDiff, diff)
    if (!(diff <= S_TOLERANCE)) problems.push(`${at} ${t.name}: S ${t.score} in TS, ${p.S} in Python`)
  }
  return { problems, maxDiff }
}

const label = (s: StudioScore) => `${s.name} ${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)} ${LABEL_NAMES[s.label]}`

let failed = false
console.log('| User | Gate | Ranked | Watchlist | max abs ΔS | Ū (TS) | Top 3 | Result |')
console.log('|---|---|---|---|---|---|---|---|')
for (const user of users) {
  if (!existsSync(join(cacheDir, `favs_${user}.json`))) {
    console.error(`${user}: no favs_${user}.json in ${cacheDir}`)
    failed = true
    continue
  }
  const loaded = await loadTopStudios({ fetch: cachedAniList(user), token: null }, user)
  if (!loaded.ok) {
    console.log(`| ${user} | | | | | | | TS failed: ${loaded.failure.kind} |`)
    failed = true
    continue
  }
  const ts: TopStudios = loaded.topStudios
  const py = runPrototype(user)
  const ranked = compareStudios('ranked', ts.studios, py.ranked)
  const watch = compareStudios('watchlist', ts.watchlist, py.watchlist)
  const problems = [...ranked.problems, ...watch.problems]
  if (ts.gate !== py.gate) problems.push(`gate ${ts.gate} in TS, ${py.gate} in Python`)
  const uDiff = Math.abs(ts.averageUtility - py.u_bar)
  if (!(uDiff <= S_TOLERANCE)) problems.push(`Ū ${ts.averageUtility} in TS, ${py.u_bar} in Python`)
  const maxDiff = Math.max(ranked.maxDiff, watch.maxDiff)
  console.log(
    `| ${user} | ${ts.gate} | ${ts.studios.length} | ${ts.watchlist.length} | ${maxDiff.toExponential(1)} | ` +
      `${ts.averageUtility.toFixed(3)} | ${ts.studios.slice(0, 3).map(label).join(', ')} | ` +
      `${problems.length ? 'MISMATCH' : 'match'} |`,
  )
  for (const problem of problems) console.error(`  ${user}: ${problem}`)
  if (problems.length) failed = true
}
console.log(failed ? '\nParity FAILED.' : `\nParity OK on ${users.length} users: ranks, labels, gate and watchlist identical, S within ${S_TOLERANCE}.`)
process.exit(failed ? 1 : 0)
