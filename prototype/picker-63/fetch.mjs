// Prototype data: real titles, years and covers from AniList's public API, baked into data.json.
import { writeFileSync } from 'node:fs'

const FIXED = [
  ['Fullmetal Alchemist: Brotherhood', 90, 'COMPLETED'], ['Steins;Gate', 90, 'COMPLETED'], ['Hunter x Hunter (2011)', 90, 'COMPLETED'],
  ['Mob Psycho 100', 90, 'COMPLETED'], ['Sousou no Frieren', 90, 'COMPLETED'], ['Monster', 90, 'COMPLETED'],
  ['Cowboy Bebop', 80, 'COMPLETED'], ['Violet Evergarden', 80, 'COMPLETED'], ['Vinland Saga', 80, 'COMPLETED'],
  ['Haikyuu!!', 80, 'COMPLETED'], ['Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen', 80, 'COMPLETED'], ['Mushishi', 80, 'COMPLETED'],
  ['Spy x Family', 70, 'COMPLETED'], ['Kimetsu no Yaiba', 70, 'COMPLETED'], ['Dr. Stone', 70, 'COMPLETED'],
  ['Yuru Camp', 70, 'COMPLETED'], ['K-On!', 70, 'COMPLETED'], ['Bocchi the Rock!', 70, 'COMPLETED'],
  ['Sword Art Online', 60, 'COMPLETED'], ['Fairy Tail', 60, 'COMPLETED'], ['Tokyo Ghoul', 60, 'COMPLETED'],
  ['Black Clover', 60, 'COMPLETED'], ['Nanatsu no Taizai', 50, 'COMPLETED'], ['Boku no Hero Academia', 50, 'COMPLETED'],
  ['Dungeon Meshi', 0, 'COMPLETED'], ['Odd Taxi', 0, 'COMPLETED'], ['Ping Pong the Animation', 0, 'COMPLETED'],
  ['Tensei Shitara Slime Datta Ken', 0, 'COMPLETED'], ['Shingeki no Kyojin', 0, 'COMPLETED'], ['Made in Abyss', 0, 'COMPLETED'],
  ['Neon Genesis Evangelion', 100, 'REPEATING'], ['Hyouka', 0, 'REPEATING'], ['One Piece', 80, 'CURRENT'],
  ['Kusuriya no Hitorigoto', 0, 'CURRENT'], ['Gintama', 70, 'PAUSED'], ['Detective Conan', 0, 'PAUSED'],
  ['Boruto: Naruto Next Generations', 30, 'DROPPED'], ['Mahouka Koukou no Rettousei', 0, 'DROPPED'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function gql(query) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query }),
    })
    if (res.status === 429) {
      await sleep(1000 * (Number(res.headers.get('retry-after')) || 30))
      continue
    }
    const json = await res.json().catch(() => ({}))
    return json.data ?? {}
  }
  return {}
}
const F = 'id title{romaji} startDate{year} coverImage{large color}'

const base = []
for (let i = 0; i < FIXED.length; i += 10) {
  const chunk = FIXED.slice(i, i + 10)
  const q = `query{${chunk.map(([n], j) => `a${i + j}: Media(search:${JSON.stringify(n)}, type:ANIME, sort:SEARCH_MATCH){${F}}`).join(' ')}}`
  const data = await gql(q)
  chunk.forEach(([name, score, status], j) => {
    const m = data[`a${i + j}`]
    base.push({ id: m?.id ?? -(i + j + 1), title: name, year: m?.startDate?.year ?? null, cover: m?.coverImage?.large ?? '', color: m?.coverImage?.color ?? '', score: score / 10, status })
  })
  await sleep(2200)
}

// A seeded generator, so the long list is the same on every build.
let seed = 20261012
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const have = new Set(base.map((t) => t.id))
const extra = []
for (let page = 1; page <= 21 && extra.length < 1010; page++) {
  const data = await gql(`query{Page(page:${page},perPage:50){media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){${F}}}}`)
  for (const m of data.Page?.media ?? []) {
    if (have.has(m.id)) continue
    have.add(m.id)
    const r = rnd()
    const status = r < 0.76 ? 'COMPLETED' : r < 0.78 ? 'REPEATING' : r < 0.82 ? 'CURRENT' : r < 0.89 ? 'PAUSED' : 'DROPPED'
    const s = rnd()
    const score = rnd() < 0.12 ? 0 : s < 0.03 ? 10 : s < 0.14 ? 9 : s < 0.38 ? 8 : s < 0.68 ? 7 : s < 0.85 ? 6 : s < 0.94 ? 5 : s < 0.98 ? 4 : 3
    extra.push({ id: m.id, title: m.title.romaji, year: m.startDate?.year ?? null, cover: m.coverImage?.large ?? '', color: m.coverImage?.color ?? '', score, status })
  }
  await sleep(2200)
}
base.forEach((t, i) => (t.done = 5000 - i * 7 + Math.floor(rnd() * 40)))
extra.forEach((t) => (t.done = Math.floor(rnd() * 4800)))

writeFileSync(new URL('./data.json', import.meta.url), JSON.stringify({ base, extra }))
console.log(`base ${base.length} (${base.filter((t) => t.cover).length} with a cover), extra ${extra.length}`)
