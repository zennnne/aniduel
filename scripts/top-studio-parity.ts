// Parity check for Top Studios (#90) and Top Directors (#103): the TypeScript port against the Python prototype.
// Usage: node scripts/top-studio-parity.ts [--cache <dir>] [user ...]
// Reads the prototype's AniList caches (list_<user>.json, favs_<user>.json, and directors_<user>.json for Directors;
// default scripts/top-studio-score, every user cached there), feeds each through a fake AniList into loadTopStudios
// and loadTopDirectors, runs prototype.py --json (and --by=director --json) on the same caches and compares. Ranks,
// labels, gate and watchlist must match exactly, S within 1e-6. Directors are matched by AniList id, since the
// prototype keys two Directors who share a name as "name (id)". Exits 1 on any difference.
// The caches hold other people's lists: they are gitignored and never committed. Needs `python` (or $PYTHON) on PATH.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ToolLoad } from '../src/anilyze/load.ts'
import type { Label } from '../src/anilyze/scoring.ts'
import { loadTopDirectors } from '../src/directors/loadTopDirectors.ts'
import { loadTopStudios } from '../src/studios/loadTopStudios.ts'

const S_TOLERANCE = 1e-6
const PROTOTYPE_DIR = fileURLToPath(new URL('./top-studio-score/', import.meta.url))

const LABEL_NAMES: Record<Label, string> = {
  elite: 'Elite',
  bold: 'Bold',
  reliable: 'Reliable',
  meh: 'Meh',
}

type PythonOne = { name: string; S: number; n: number; hit: number; flop: number; tag: string; id?: number }
type PythonResult = { user: string; gate: number; u_bar: number; ranked: PythonOne[]; watchlist: PythonOne[] }
type PythonTooFew = { user: string; too_few_scored: number }

/** One ranked studio or Director on the TypeScript side. */
type TsOne = { id: number; name: string; score: number; label: Label; votes: unknown[] }
/** A tool's result as the comparison reads it. */
type TsResult = { gate: number; averageUtility: number; ranked: TsOne[]; watchlist: TsOne[] }

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

type CachedEntry = { mediaId: number; media: Record<string, unknown> }
/** directors_<user>.json: each title's cached Director-ish credits, [staff id, name, role]. */
type CachedCredits = Record<string, Array<[number, string, string]>>

/**
 * A fake AniList that answers a tool's queries from the prototype's caches: one list chunk, favourites by 25. With
 * `credits`, each title's media carries its cached staff credits, as the Top Directors query reads them.
 */
function cachedAniList(user: string, credits?: CachedCredits): typeof fetch {
  const cached: CachedEntry[] = JSON.parse(readFileSync(join(cacheDir, `list_${user}.json`), 'utf8'))
  const entries = credits
    ? cached.map((e) => ({
        ...e,
        media: {
          ...e.media,
          staff: {
            edges: (credits[String(e.mediaId)] ?? []).map(([id, name, role]) => ({
              role,
              node: { id, name: { full: name }, image: null, siteUrl: `https://anilist.co/staff/${id}` },
            })),
          },
        },
      }))
    : cached
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

function runPrototype(user: string, by: 'studio' | 'director'): PythonResult | PythonTooFew {
  const out = execFileSync(
    process.env.PYTHON ?? 'python',
    ['-I', join(PROTOTYPE_DIR, 'prototype.py'), user, '--json', `--by=${by}`, `--cache=${cacheDir}`],
    { encoding: 'utf8' },
  )
  return JSON.parse(out)
}

/** The differences between one list on both sides, as lines; empty when they match. */
function compare(what: string, ts: TsOne[], py: PythonOne[], byId: boolean): { problems: string[]; maxDiff: number } {
  const problems: string[] = []
  let maxDiff = 0
  if (ts.length !== py.length) problems.push(`${what}: ${ts.length} in TS, ${py.length} in Python`)
  for (let i = 0; i < Math.min(ts.length, py.length); i++) {
    const [t, p] = [ts[i], py[i]]
    const at = `${what} #${i + 1}`
    if (byId ? t.id !== p.id : t.name !== p.name) problems.push(`${at}: ${t.name} (${t.id}) in TS, ${p.name} (${p.id}) in Python`)
    if (LABEL_NAMES[t.label] !== p.tag) problems.push(`${at} ${t.name}: ${LABEL_NAMES[t.label]} in TS, ${p.tag} in Python`)
    if (t.votes.length !== p.n) problems.push(`${at} ${t.name}: ${t.votes.length} entries in TS, ${p.n} in Python`)
    const diff = Math.abs(t.score - p.S)
    maxDiff = Math.max(maxDiff, diff)
    if (!(diff <= S_TOLERANCE)) problems.push(`${at} ${t.name}: S ${t.score} in TS, ${p.S} in Python`)
  }
  return { problems, maxDiff }
}

const label = (s: TsOne) => `${s.name} ${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)} ${LABEL_NAMES[s.label]}`

type Tool = {
  title: string
  by: 'studio' | 'director'
  /** Whether a user can be checked, and why not. */
  missing: (user: string) => string | null
  load: (user: string) => Promise<ToolLoad<{ ok: true; result: TsResult }>>
}

const TOOLS: Tool[] = [
  {
    title: 'Top Studios',
    by: 'studio',
    missing: () => null,
    load: async (user) => {
      const loaded = await loadTopStudios({ fetch: cachedAniList(user), token: null }, user)
      if (!loaded.ok) return loaded
      const { studios, watchlist, gate, averageUtility } = loaded.topStudios
      return { ok: true, result: { ranked: studios, watchlist, gate, averageUtility } }
    },
  },
  {
    title: 'Top Directors',
    by: 'director',
    missing: (user) => (existsSync(join(cacheDir, `directors_${user}.json`)) ? null : `no directors_${user}.json`),
    load: async (user) => {
      const credits: CachedCredits = JSON.parse(readFileSync(join(cacheDir, `directors_${user}.json`), 'utf8'))
      const loaded = await loadTopDirectors({ fetch: cachedAniList(user, credits), token: null }, user)
      if (!loaded.ok) return loaded
      const { directors, watchlist, gate, averageUtility } = loaded.topDirectors
      return { ok: true, result: { ranked: directors, watchlist, gate, averageUtility } }
    },
  },
]

let failed = false
for (const tool of TOOLS) {
  console.log(`\n## ${tool.title}\n`)
  console.log('| User | Gate | Ranked | Watchlist | max abs ΔS | Ū (TS) | Top 3 | Result |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const user of users) {
    const missing = existsSync(join(cacheDir, `favs_${user}.json`)) ? tool.missing(user) : `no favs_${user}.json`
    if (missing) {
      console.error(`${user}: ${missing} in ${cacheDir}`)
      failed = true
      continue
    }
    const loaded = await tool.load(user)
    const py = runPrototype(user, tool.by)
    if ('too_few_scored' in py) {
      // Both sides must refuse the list for the same count of scored titles.
      const same = !loaded.ok && loaded.failure.kind === 'too-few-scored' && loaded.failure.scored === py.too_few_scored
      console.log(`| ${user} | | | | | | ${py.too_few_scored} scored: too few to rank | ${same ? 'match' : 'MISMATCH'} |`)
      if (!same) failed = true
      continue
    }
    if (!loaded.ok) {
      console.log(`| ${user} | | | | | | | TS failed: ${loaded.failure.kind} |`)
      failed = true
      continue
    }
    const ts = loaded.result
    const byId = tool.by === 'director'
    const ranked = compare('ranked', ts.ranked, py.ranked, byId)
    const watch = compare('watchlist', ts.watchlist, py.watchlist, byId)
    const problems = [...ranked.problems, ...watch.problems]
    if (ts.gate !== py.gate) problems.push(`gate ${ts.gate} in TS, ${py.gate} in Python`)
    const uDiff = Math.abs(ts.averageUtility - py.u_bar)
    if (!(uDiff <= S_TOLERANCE)) problems.push(`Ū ${ts.averageUtility} in TS, ${py.u_bar} in Python`)
    const maxDiff = Math.max(ranked.maxDiff, watch.maxDiff)
    console.log(
      `| ${user} | ${ts.gate} | ${ts.ranked.length} | ${ts.watchlist.length} | ${maxDiff.toExponential(1)} | ` +
        `${ts.averageUtility.toFixed(3)} | ${ts.ranked.slice(0, 3).map(label).join(', ')} | ` +
        `${problems.length ? 'MISMATCH' : 'match'} |`,
    )
    for (const problem of problems) console.error(`  ${tool.title}, ${user}: ${problem}`)
    if (problems.length) failed = true
  }
}
console.log(
  failed
    ? '\nParity FAILED.'
    : `\nParity OK on ${users.length} users for studios and Directors: ranks, labels, gate and watchlist identical, S within ${S_TOLERANCE}.`,
)
process.exit(failed ? 1 : 0)
