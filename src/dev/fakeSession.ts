// Dev only (#68): the app signed in against a fake AniList with a fixed list, so UI can be checked without a login
// or the network. Opened with `?fake-anilist` under `npm run dev`; src/main.tsx keeps it out of the production build.
import { fakeAniList } from '../anilist/fakeAniList.ts'
import type { AniListSession } from '../anilist/gateway.ts'
import type { ListStatus } from '../anilist/types.ts'
import { browserClock, type Clock } from '../clock.ts'
import { deleteSavedProgress } from '../persistence/progress.ts'

/** The fixed list: name, AniList score (100-point, 0 = none) and status. Enough scored titles on enough scores for Keep My Scale. */
const FIXED_LIST: ReadonlyArray<readonly [name: string, score100: number, status: ListStatus]> = [
  ['Fullmetal Alchemist: Brotherhood', 90, 'COMPLETED'],
  ['Steins;Gate', 90, 'COMPLETED'],
  ['Hunter x Hunter (2011)', 90, 'COMPLETED'],
  ['Mob Psycho 100', 90, 'COMPLETED'],
  ['Sousou no Frieren', 90, 'COMPLETED'],
  ['Monster', 90, 'COMPLETED'],
  ['Cowboy Bebop', 80, 'COMPLETED'],
  ['Violet Evergarden', 80, 'COMPLETED'],
  ['Vinland Saga', 80, 'COMPLETED'],
  ['Haikyuu!!', 80, 'COMPLETED'],
  ['Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen', 80, 'COMPLETED'],
  ['Mushishi', 80, 'COMPLETED'],
  ['Spy x Family', 70, 'COMPLETED'],
  ['Kimetsu no Yaiba', 70, 'COMPLETED'],
  ['Dr. Stone', 70, 'COMPLETED'],
  ['Yuru Camp', 70, 'COMPLETED'],
  ['K-On!', 70, 'COMPLETED'],
  ['Bocchi the Rock!', 70, 'COMPLETED'],
  ['Sword Art Online', 60, 'COMPLETED'],
  ['Fairy Tail', 60, 'COMPLETED'],
  ['Tokyo Ghoul', 60, 'COMPLETED'],
  ['Black Clover', 60, 'COMPLETED'],
  ['Nanatsu no Taizai', 50, 'COMPLETED'],
  ['Boku no Hero Academia', 50, 'COMPLETED'],
  ['Dungeon Meshi', 0, 'COMPLETED'],
  ['Odd Taxi', 0, 'COMPLETED'],
  ['Ping Pong the Animation', 0, 'COMPLETED'],
  ['Tensei Shitara Slime Datta Ken', 0, 'COMPLETED'],
  ['Shingeki no Kyojin', 0, 'COMPLETED'],
  ['Made in Abyss', 0, 'COMPLETED'],
  ['Neon Genesis Evangelion', 100, 'REPEATING'],
  ['Hyouka', 0, 'REPEATING'],
  ['One Piece', 80, 'CURRENT'],
  ['Kusuriya no Hitorigoto', 0, 'CURRENT'],
  ['Gintama', 70, 'PAUSED'],
  ['Detective Conan', 0, 'PAUSED'],
  ['Boruto: Naruto Next Generations', 30, 'DROPPED'],
  ['Mahouka Koukou no Rettousei', 0, 'DROPPED'],
]

/**
 * A session on a fresh fake AniList: every page load starts from the fixed list again, and writes go to the fake only.
 * What an earlier fake session saved in `storage` is thrown away with it, so the app opens on Start.
 */
export function fakeSession(storage: Storage, clock: Clock = browserClock): AniListSession {
  const byId = <T>(pick: (row: (typeof FIXED_LIST)[number]) => T) => Object.fromEntries(FIXED_LIST.map((row, i) => [i + 1, pick(row)]))
  const aniList = fakeAniList(clock, byId(([, score100]) => score100), {
    statuses: byId(([, , status]) => status),
    titles: byId(([name]) => name),
  })
  // No real account has id 0, so nothing saved for one is touched.
  Object.assign(aniList.viewer, { id: 0, name: 'Fake Zen' })
  deleteSavedProgress(storage, aniList.viewer.id)
  return { fetch: aniList.fetch, token: 'fake' }
}
