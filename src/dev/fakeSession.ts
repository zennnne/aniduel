// Dev only (#68): the app signed in against a fake AniList with a fixed list, so UI can be checked without a login
// or the network. Opened with `?fake-anilist` under `npm run dev`; src/main.tsx keeps it out of the production build.
import { fakeAniList, type FakeMedia } from '../anilist/fakeAniList.ts'
import type { AniListSession } from '../anilist/gateway.ts'
import type { ListStatus } from '../anilist/types.ts'
import { browserClock, type Clock } from '../clock.ts'
import { deleteSavedProgress } from '../persistence/progress.ts'

/**
 * The fixed list: name, AniList score (100-point, 0 = none), status, release year, year completed, genres and tags.
 * Enough scored titles on enough scores for Keep My Scale; years, genres and tags to try the Picker's filters (#65). A
 * tag is `name:rank`, and a leading `!` marks a spoiler tag. A few ranks sit under 50, which the Picker doesn't count.
 */
const FIXED_LIST: ReadonlyArray<
  readonly [name: string, score100: number, status: ListStatus, year: number | null, completed: number | null, genres: string[], tags: string[]]
> = [
  ['Fullmetal Alchemist: Brotherhood', 90, 'COMPLETED', 2009, 2016, ['Action', 'Adventure', 'Drama', 'Fantasy'], ['Military:92', 'Alchemy:95', 'Male Protagonist:90', 'Brothers:88', '!Homunculus Reveal:70']],
  ['Steins;Gate', 90, 'COMPLETED', 2011, 2017, ['Drama', 'Sci-Fi', 'Thriller'], ['Time Manipulation:96', 'Time Loop:90', 'Male Protagonist:88', 'Otaku Culture:45', '!Twist Ending:80']],
  ['Hunter x Hunter (2011)', 90, 'COMPLETED', 2011, 2018, ['Action', 'Adventure', 'Fantasy'], ['Super Power:85', 'Male Protagonist:90', 'Tournament:62', 'Shounen:93']],
  ['Mob Psycho 100', 90, 'COMPLETED', 2016, 2019, ['Action', 'Comedy', 'Supernatural'], ['Super Power:92', 'Male Protagonist:94', 'Shounen:80', 'Psychic Powers:95']],
  ['Sousou no Frieren', 90, 'COMPLETED', 2023, 2024, ['Adventure', 'Drama', 'Fantasy'], ['Elf:97', 'Female Protagonist:95', 'Iyashikei:52', 'Magic:93', 'Time Skip:65']],
  ['Monster', 90, 'COMPLETED', 2004, 2015, ['Drama', 'Mystery', 'Psychological', 'Thriller'], ['Serial Killer:94', 'Male Protagonist:90', 'Seinen:91', 'Medicine:80']],
  ['Cowboy Bebop', 80, 'COMPLETED', 1998, 2014, ['Action', 'Drama', 'Sci-Fi'], ['Space:93', 'Bounty Hunter:96', 'Ensemble Cast:80', 'Episodic:85']],
  ['Violet Evergarden', 80, 'COMPLETED', 2018, 2019, ['Drama', 'Fantasy', 'Slice of Life'], ['Female Protagonist:96', 'Military:60', 'Tragedy:75', 'Episodic:62']],
  ['Vinland Saga', 80, 'COMPLETED', 2019, 2020, ['Action', 'Adventure', 'Drama'], ['Vikings:97', 'Revenge:90', 'Male Protagonist:93', 'Seinen:88', 'War:85']],
  ['Haikyuu!!', 80, 'COMPLETED', 2014, 2016, ['Comedy', 'Drama', 'Sports'], ['Volleyball:98', 'Ensemble Cast:85', 'School:82', 'Shounen:90', 'Male Protagonist:70']],
  ['Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen', 80, 'COMPLETED', 2019, 2019, ['Comedy', 'Psychological', 'Romance'], ['School:88', 'Rom-Com:94', 'Student Council:96', 'Heterosexual:72']],
  ['Mushishi', 80, 'COMPLETED', 2005, null, ['Adventure', 'Mystery', 'Slice of Life', 'Supernatural'], ['Iyashikei:85', 'Episodic:96', 'Male Protagonist:90', 'Seinen:84']],
  ['Spy x Family', 70, 'COMPLETED', 2022, 2022, ['Action', 'Comedy', 'Slice of Life'], ['Found Family:94', 'Espionage:96', 'Male Protagonist:80', 'Shounen:85']],
  ['Kimetsu no Yaiba', 70, 'COMPLETED', 2019, 2020, ['Action', 'Adventure', 'Drama', 'Fantasy', 'Supernatural'], ['Demons:95', 'Swordplay:92', 'Male Protagonist:94', 'Shounen:96', 'Super Power:30']],
  ['Dr. Stone', 70, 'COMPLETED', 2019, 2021, ['Action', 'Adventure', 'Comedy', 'Sci-Fi'], ['Post-Apocalyptic:93', 'Science:97', 'Male Protagonist:94', 'Shounen:90']],
  ['Yuru Camp', 70, 'COMPLETED', 2018, 2019, ['Slice of Life'], ['Iyashikei:96', 'Cute Girls Doing Cute Things:94', 'Camping:98', 'Female Protagonist:80']],
  ['K-On!', 70, 'COMPLETED', 2009, 2013, ['Comedy', 'Music', 'Slice of Life'], ['Cute Girls Doing Cute Things:97', 'Band:95', 'School Club:93', 'Iyashikei:60']],
  ['Bocchi the Rock!', 70, 'COMPLETED', 2022, 2023, ['Comedy', 'Music'], ['Band:97', 'Female Protagonist:95', 'Cute Girls Doing Cute Things:85', 'Social Anxiety:93']],
  ['Sword Art Online', 60, 'COMPLETED', 2012, 2014, ['Action', 'Adventure', 'Fantasy', 'Romance'], ['Video Games:95', 'Virtual World:97', 'Male Protagonist:94', 'Isekai:40']],
  ['Fairy Tail', 60, 'COMPLETED', 2009, null, ['Action', 'Adventure', 'Comedy', 'Fantasy'], ['Magic:95', 'Guilds:93', 'Shounen:94', 'Ensemble Cast:70']],
  ['Tokyo Ghoul', 60, 'COMPLETED', 2014, 2015, ['Action', 'Drama', 'Horror', 'Mystery', 'Psychological', 'Supernatural'], ['Gore:90', 'Seinen:85', 'Male Protagonist:93', 'Tragedy:70', '!Main Character Dies:40']],
  ['Black Clover', 60, 'COMPLETED', 2017, 2021, ['Action', 'Comedy', 'Fantasy'], ['Magic:96', 'Shounen:95', 'Male Protagonist:93', 'Orphan:70']],
  ['Nanatsu no Taizai', 50, 'COMPLETED', 2014, null, ['Action', 'Adventure', 'Fantasy'], ['Shounen:92', 'Demons:70', 'Male Protagonist:85', 'Ensemble Cast:68']],
  ['Boku no Hero Academia', 50, 'COMPLETED', 2016, 2017, ['Action', 'Adventure', 'Comedy'], ['Super Power:97', 'Superhero:96', 'School:85', 'Shounen:95', 'Male Protagonist:94']],
  ['Dungeon Meshi', 0, 'COMPLETED', 2024, 2024, ['Adventure', 'Comedy', 'Fantasy'], ['Food:97', 'Dungeon:95', 'Elf:60', 'Ensemble Cast:82', 'Male Protagonist:66']],
  ['Odd Taxi', 0, 'COMPLETED', 2021, 2025, ['Drama', 'Mystery', 'Thriller'], ['Anthropomorphism:96', 'Ensemble Cast:85', 'Male Protagonist:90', '!Twist Ending:90']],
  ['Ping Pong the Animation', 0, 'COMPLETED', 2014, 2025, ['Drama', 'Sports'], ['Table Tennis:98', 'Male Protagonist:85', 'Coming of Age:80', 'Seinen:60']],
  ['Tensei Shitara Slime Datta Ken', 0, 'COMPLETED', 2018, null, ['Action', 'Adventure', 'Comedy', 'Fantasy'], ['Isekai:97', 'Reincarnation:95', 'Male Protagonist:80', 'Magic:88']],
  ['Shingeki no Kyojin', 0, 'COMPLETED', 2013, 2024, ['Action', 'Drama', 'Fantasy', 'Mystery'], ['Military:90', 'Gore:85', 'Male Protagonist:92', 'Shounen:88', '!Titan Shifters:85', 'Dystopian:75']],
  ['Made in Abyss', 0, 'COMPLETED', 2017, 2025, ['Adventure', 'Drama', 'Fantasy', 'Mystery', 'Sci-Fi'], ['Survival:92', 'Body Horror:75', 'Female Protagonist:70', 'Robots:65']],
  ['Neon Genesis Evangelion', 100, 'REPEATING', 1995, 2012, ['Action', 'Drama', 'Mecha', 'Psychological', 'Sci-Fi'], ['Mecha:96', 'Post-Apocalyptic:80', 'Male Protagonist:94', 'Coming of Age:72', '!Human Instrumentality:60']],
  ['Hyouka', 0, 'REPEATING', 2012, 2025, ['Mystery', 'Slice of Life'], ['School Club:90', 'Detective:85', 'Male Protagonist:92', 'Iyashikei:45']],
  ['One Piece', 80, 'CURRENT', 1999, null, ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'], ['Pirates:98', 'Shounen:96', 'Ensemble Cast:90', 'Super Power:85']],
  ['Kusuriya no Hitorigoto', 0, 'CURRENT', 2023, null, ['Drama', 'Mystery'], ['Medicine:93', 'Female Protagonist:96', 'Detective:80', 'Historical:85']],
  ['Gintama', 70, 'PAUSED', 2006, null, ['Action', 'Comedy', 'Sci-Fi'], ['Parody:96', 'Samurai:90', 'Episodic:80', 'Shounen:88', 'Male Protagonist:90']],
  ['Detective Conan', 0, 'PAUSED', 1996, null, ['Adventure', 'Comedy', 'Mystery'], ['Detective:98', 'Episodic:93', 'Male Protagonist:95', 'Shounen:80']],
  ['Boruto: Naruto Next Generations', 30, 'DROPPED', 2017, null, ['Action', 'Adventure'], ['Ninja:97', 'Shounen:94', 'Male Protagonist:93', 'Super Power:80']],
  ['Mahouka Koukou no Rettousei', 0, 'DROPPED', null, null, ['Action', 'Fantasy', 'Romance', 'Sci-Fi'], ['Magic:95', 'School:90', 'Male Protagonist:93', 'Overpowered Main Characters:88']],
]

/** A title's release year, completion date (mid-year, so the default sort has something to order), genres and tags. */
function mediaOf([, , , year, completed, genres, tags]: (typeof FIXED_LIST)[number]): FakeMedia {
  return {
    year,
    completedAt: completed === null ? null : { year: completed, month: 6, day: 1 },
    genres,
    tags: tags.map((tag) => {
      const [, spoiler, name, rank] = /^(!?)(.+):(\d+)$/.exec(tag)!
      return { name, rank: Number(rank), spoiler: spoiler === '!' }
    }),
  }
}

/**
 * A session on a fresh fake AniList: every page load starts from the fixed list again, and writes go to the fake only.
 * What an earlier fake session saved in `storage` is thrown away with it, so the app opens on Start.
 */
export function fakeSession(storage: Storage, clock: Clock = browserClock): AniListSession {
  const byId = <T>(pick: (row: (typeof FIXED_LIST)[number]) => T) => Object.fromEntries(FIXED_LIST.map((row, i) => [i + 1, pick(row)]))
  const aniList = fakeAniList(clock, byId(([, score100]) => score100), {
    statuses: byId(([, , status]) => status),
    titles: byId(([name]) => name),
    media: byId(mediaOf),
  })
  // No real account has id 0, so nothing saved for one is touched.
  Object.assign(aniList.viewer, { id: 0, name: 'Fake Zen' })
  deleteSavedProgress(storage, aniList.viewer.id)
  return { fetch: aniList.fetch, token: 'fake' }
}
