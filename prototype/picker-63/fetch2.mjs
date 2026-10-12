// Adds genres and tags to data.json (round 4: genre and tag filters). Tags: not spoilers, rank 50+, the top 8.
import { readFileSync, writeFileSync } from 'node:fs'
const file = new URL('./data.json', import.meta.url)
const data = JSON.parse(readFileSync(file, 'utf8'))
const all = data.base.concat(data.extra)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const byId = new Map()
const ids = all.map((t) => t.id).filter((id) => id > 0)
for (let i = 0; i < ids.length; i += 50) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: `query{Page(perPage:50){media(id_in:[${ids.slice(i, i + 50)}]){id genres tags{name rank isMediaSpoiler isGeneralSpoiler}}}}` }),
    })
    if (res.status === 429) { await sleep(1000 * (Number(res.headers.get('retry-after')) || 30)); continue }
    const json = await res.json().catch(() => ({}))
    for (const m of json.data?.Page?.media ?? []) byId.set(m.id, m)
    break
  }
  await sleep(2200)
}
for (const t of all) {
  const m = byId.get(t.id)
  t.g = m?.genres ?? []
  t.tg = (m?.tags ?? []).filter((x) => !x.isMediaSpoiler && !x.isGeneralSpoiler && x.rank >= 50).sort((a, b) => b.rank - a.rank).slice(0, 8).map((x) => x.name)
}
writeFileSync(file, JSON.stringify(data))
console.log(`with genres: ${all.filter((t) => t.g.length).length}/${all.length}, distinct tags: ${new Set(all.flatMap((t) => t.tg)).size}`)
