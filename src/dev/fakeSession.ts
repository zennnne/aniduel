// Dev only (#68): the app signed in against a fake AniList with a fixed list, so UI can be checked without a login
// or the network. Opened with `?fake-anilist` under `npm run dev`; src/main.tsx keeps it out of the production build.
import { fakeAniList, type FakeMedia } from '../anilist/fakeAniList.ts'
import type { AniListSession } from '../anilist/gateway.ts'
import type { ListStatus } from '../anilist/types.ts'
import { browserClock, type Clock } from '../clock.ts'
import { deleteSavedProgress } from '../persistence/progress.ts'

/** One title of the fixed list. */
type FixedTitle = {
  name: string
  /** AniList score, 100-point; 0 = none. */
  score: number
  status: ListStatus
  /** Release year. */
  year: number | null
  /** The year it was completed (on 1 June, so the default sort has something to order). */
  completed: number | null
  genres: string[]
  tags: Array<{ name: string; rank: number; spoiler?: boolean }>
}

/**
 * The fixed list. Enough scored titles on enough scores for Keep My Scale; years, genres and tags to try the Picker's
 * filters (#65), spoiler tags and a few ranks under 50 among them, which the Picker doesn't count. Two Planning titles,
 * one scored: an Anchor the Picker never lists.
 */
const FIXED_LIST: readonly FixedTitle[] = [
  { name: 'Fullmetal Alchemist: Brotherhood', score: 90, status: 'COMPLETED', year: 2009, completed: 2016, genres: ['Action', 'Adventure', 'Drama', 'Fantasy'], tags: [{ name: 'Military', rank: 92 }, { name: 'Alchemy', rank: 95 }, { name: 'Male Protagonist', rank: 90 }, { name: 'Brothers', rank: 88 }, { name: 'Homunculus Reveal', rank: 70, spoiler: true }] },
  { name: 'Steins;Gate', score: 90, status: 'COMPLETED', year: 2011, completed: 2017, genres: ['Drama', 'Sci-Fi', 'Thriller'], tags: [{ name: 'Time Manipulation', rank: 96 }, { name: 'Time Loop', rank: 90 }, { name: 'Male Protagonist', rank: 88 }, { name: 'Otaku Culture', rank: 45 }, { name: 'Twist Ending', rank: 80, spoiler: true }] },
  { name: 'Hunter x Hunter (2011)', score: 90, status: 'COMPLETED', year: 2011, completed: 2018, genres: ['Action', 'Adventure', 'Fantasy'], tags: [{ name: 'Super Power', rank: 85 }, { name: 'Male Protagonist', rank: 90 }, { name: 'Tournament', rank: 62 }, { name: 'Shounen', rank: 93 }] },
  { name: 'Mob Psycho 100', score: 90, status: 'COMPLETED', year: 2016, completed: 2019, genres: ['Action', 'Comedy', 'Supernatural'], tags: [{ name: 'Super Power', rank: 92 }, { name: 'Male Protagonist', rank: 94 }, { name: 'Shounen', rank: 80 }, { name: 'Psychic Powers', rank: 95 }] },
  { name: 'Sousou no Frieren', score: 90, status: 'COMPLETED', year: 2023, completed: 2024, genres: ['Adventure', 'Drama', 'Fantasy'], tags: [{ name: 'Elf', rank: 97 }, { name: 'Female Protagonist', rank: 95 }, { name: 'Iyashikei', rank: 52 }, { name: 'Magic', rank: 93 }, { name: 'Time Skip', rank: 65 }] },
  { name: 'Monster', score: 90, status: 'COMPLETED', year: 2004, completed: 2015, genres: ['Drama', 'Mystery', 'Psychological', 'Thriller'], tags: [{ name: 'Serial Killer', rank: 94 }, { name: 'Male Protagonist', rank: 90 }, { name: 'Seinen', rank: 91 }, { name: 'Medicine', rank: 80 }] },
  { name: 'Cowboy Bebop', score: 80, status: 'COMPLETED', year: 1998, completed: 2014, genres: ['Action', 'Drama', 'Sci-Fi'], tags: [{ name: 'Space', rank: 93 }, { name: 'Bounty Hunter', rank: 96 }, { name: 'Ensemble Cast', rank: 80 }, { name: 'Episodic', rank: 85 }] },
  { name: 'Violet Evergarden', score: 80, status: 'COMPLETED', year: 2018, completed: 2019, genres: ['Drama', 'Fantasy', 'Slice of Life'], tags: [{ name: 'Female Protagonist', rank: 96 }, { name: 'Military', rank: 60 }, { name: 'Tragedy', rank: 75 }, { name: 'Episodic', rank: 62 }] },
  { name: 'Vinland Saga', score: 80, status: 'COMPLETED', year: 2019, completed: 2020, genres: ['Action', 'Adventure', 'Drama'], tags: [{ name: 'Vikings', rank: 97 }, { name: 'Revenge', rank: 90 }, { name: 'Male Protagonist', rank: 93 }, { name: 'Seinen', rank: 88 }, { name: 'War', rank: 85 }] },
  { name: 'Haikyuu!!', score: 80, status: 'COMPLETED', year: 2014, completed: 2016, genres: ['Comedy', 'Drama', 'Sports'], tags: [{ name: 'Volleyball', rank: 98 }, { name: 'Ensemble Cast', rank: 85 }, { name: 'School', rank: 82 }, { name: 'Shounen', rank: 90 }, { name: 'Male Protagonist', rank: 70 }] },
  { name: 'Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen', score: 80, status: 'COMPLETED', year: 2019, completed: 2019, genres: ['Comedy', 'Psychological', 'Romance'], tags: [{ name: 'School', rank: 88 }, { name: 'Rom-Com', rank: 94 }, { name: 'Student Council', rank: 96 }, { name: 'Heterosexual', rank: 72 }] },
  { name: 'Mushishi', score: 80, status: 'COMPLETED', year: 2005, completed: null, genres: ['Adventure', 'Mystery', 'Slice of Life', 'Supernatural'], tags: [{ name: 'Iyashikei', rank: 85 }, { name: 'Episodic', rank: 96 }, { name: 'Male Protagonist', rank: 90 }, { name: 'Seinen', rank: 84 }] },
  { name: 'Spy x Family', score: 70, status: 'COMPLETED', year: 2022, completed: 2022, genres: ['Action', 'Comedy', 'Slice of Life'], tags: [{ name: 'Found Family', rank: 94 }, { name: 'Espionage', rank: 96 }, { name: 'Male Protagonist', rank: 80 }, { name: 'Shounen', rank: 85 }] },
  { name: 'Kimetsu no Yaiba', score: 70, status: 'COMPLETED', year: 2019, completed: 2020, genres: ['Action', 'Adventure', 'Drama', 'Fantasy', 'Supernatural'], tags: [{ name: 'Demons', rank: 95 }, { name: 'Swordplay', rank: 92 }, { name: 'Male Protagonist', rank: 94 }, { name: 'Shounen', rank: 96 }, { name: 'Super Power', rank: 30 }] },
  { name: 'Dr. Stone', score: 70, status: 'COMPLETED', year: 2019, completed: 2021, genres: ['Action', 'Adventure', 'Comedy', 'Sci-Fi'], tags: [{ name: 'Post-Apocalyptic', rank: 93 }, { name: 'Science', rank: 97 }, { name: 'Male Protagonist', rank: 94 }, { name: 'Shounen', rank: 90 }] },
  { name: 'Yuru Camp', score: 70, status: 'COMPLETED', year: 2018, completed: 2019, genres: ['Slice of Life'], tags: [{ name: 'Iyashikei', rank: 96 }, { name: 'Cute Girls Doing Cute Things', rank: 94 }, { name: 'Camping', rank: 98 }, { name: 'Female Protagonist', rank: 80 }] },
  { name: 'K-On!', score: 70, status: 'COMPLETED', year: 2009, completed: 2013, genres: ['Comedy', 'Music', 'Slice of Life'], tags: [{ name: 'Cute Girls Doing Cute Things', rank: 97 }, { name: 'Band', rank: 95 }, { name: 'School Club', rank: 93 }, { name: 'Iyashikei', rank: 60 }] },
  { name: 'Bocchi the Rock!', score: 70, status: 'COMPLETED', year: 2022, completed: 2023, genres: ['Comedy', 'Music'], tags: [{ name: 'Band', rank: 97 }, { name: 'Female Protagonist', rank: 95 }, { name: 'Cute Girls Doing Cute Things', rank: 85 }, { name: 'Social Anxiety', rank: 93 }] },
  { name: 'Sword Art Online', score: 60, status: 'COMPLETED', year: 2012, completed: 2014, genres: ['Action', 'Adventure', 'Fantasy', 'Romance'], tags: [{ name: 'Video Games', rank: 95 }, { name: 'Virtual World', rank: 97 }, { name: 'Male Protagonist', rank: 94 }, { name: 'Isekai', rank: 40 }] },
  { name: 'Fairy Tail', score: 60, status: 'COMPLETED', year: 2009, completed: null, genres: ['Action', 'Adventure', 'Comedy', 'Fantasy'], tags: [{ name: 'Magic', rank: 95 }, { name: 'Guilds', rank: 93 }, { name: 'Shounen', rank: 94 }, { name: 'Ensemble Cast', rank: 70 }] },
  { name: 'Tokyo Ghoul', score: 60, status: 'COMPLETED', year: 2014, completed: 2015, genres: ['Action', 'Drama', 'Horror', 'Mystery', 'Psychological', 'Supernatural'], tags: [{ name: 'Gore', rank: 90 }, { name: 'Seinen', rank: 85 }, { name: 'Male Protagonist', rank: 93 }, { name: 'Tragedy', rank: 70 }, { name: 'Main Character Dies', rank: 40, spoiler: true }] },
  { name: 'Black Clover', score: 60, status: 'COMPLETED', year: 2017, completed: 2021, genres: ['Action', 'Comedy', 'Fantasy'], tags: [{ name: 'Magic', rank: 96 }, { name: 'Shounen', rank: 95 }, { name: 'Male Protagonist', rank: 93 }, { name: 'Orphan', rank: 70 }] },
  { name: 'Nanatsu no Taizai', score: 50, status: 'COMPLETED', year: 2014, completed: null, genres: ['Action', 'Adventure', 'Fantasy'], tags: [{ name: 'Shounen', rank: 92 }, { name: 'Demons', rank: 70 }, { name: 'Male Protagonist', rank: 85 }, { name: 'Ensemble Cast', rank: 68 }] },
  { name: 'Boku no Hero Academia', score: 50, status: 'COMPLETED', year: 2016, completed: 2017, genres: ['Action', 'Adventure', 'Comedy'], tags: [{ name: 'Super Power', rank: 97 }, { name: 'Superhero', rank: 96 }, { name: 'School', rank: 85 }, { name: 'Shounen', rank: 95 }, { name: 'Male Protagonist', rank: 94 }] },
  { name: 'Dungeon Meshi', score: 0, status: 'COMPLETED', year: 2024, completed: 2024, genres: ['Adventure', 'Comedy', 'Fantasy'], tags: [{ name: 'Food', rank: 97 }, { name: 'Dungeon', rank: 95 }, { name: 'Elf', rank: 60 }, { name: 'Ensemble Cast', rank: 82 }, { name: 'Male Protagonist', rank: 66 }] },
  { name: 'Odd Taxi', score: 0, status: 'COMPLETED', year: 2021, completed: 2025, genres: ['Drama', 'Mystery', 'Thriller'], tags: [{ name: 'Anthropomorphism', rank: 96 }, { name: 'Ensemble Cast', rank: 85 }, { name: 'Male Protagonist', rank: 90 }, { name: 'Twist Ending', rank: 90, spoiler: true }] },
  { name: 'Ping Pong the Animation', score: 0, status: 'COMPLETED', year: 2014, completed: 2025, genres: ['Drama', 'Sports'], tags: [{ name: 'Table Tennis', rank: 98 }, { name: 'Male Protagonist', rank: 85 }, { name: 'Coming of Age', rank: 80 }, { name: 'Seinen', rank: 60 }] },
  { name: 'Tensei Shitara Slime Datta Ken', score: 0, status: 'COMPLETED', year: 2018, completed: null, genres: ['Action', 'Adventure', 'Comedy', 'Fantasy'], tags: [{ name: 'Isekai', rank: 97 }, { name: 'Reincarnation', rank: 95 }, { name: 'Male Protagonist', rank: 80 }, { name: 'Magic', rank: 88 }] },
  { name: 'Shingeki no Kyojin', score: 0, status: 'COMPLETED', year: 2013, completed: 2024, genres: ['Action', 'Drama', 'Fantasy', 'Mystery'], tags: [{ name: 'Military', rank: 90 }, { name: 'Gore', rank: 85 }, { name: 'Male Protagonist', rank: 92 }, { name: 'Shounen', rank: 88 }, { name: 'Titan Shifters', rank: 85, spoiler: true }, { name: 'Dystopian', rank: 75 }] },
  { name: 'Made in Abyss', score: 0, status: 'COMPLETED', year: 2017, completed: 2025, genres: ['Adventure', 'Drama', 'Fantasy', 'Mystery', 'Sci-Fi'], tags: [{ name: 'Survival', rank: 92 }, { name: 'Body Horror', rank: 75 }, { name: 'Female Protagonist', rank: 70 }, { name: 'Robots', rank: 65 }] },
  { name: 'Neon Genesis Evangelion', score: 100, status: 'REPEATING', year: 1995, completed: 2012, genres: ['Action', 'Drama', 'Mecha', 'Psychological', 'Sci-Fi'], tags: [{ name: 'Mecha', rank: 96 }, { name: 'Post-Apocalyptic', rank: 80 }, { name: 'Male Protagonist', rank: 94 }, { name: 'Coming of Age', rank: 72 }, { name: 'Human Instrumentality', rank: 60, spoiler: true }] },
  { name: 'Hyouka', score: 0, status: 'REPEATING', year: 2012, completed: 2025, genres: ['Mystery', 'Slice of Life'], tags: [{ name: 'School Club', rank: 90 }, { name: 'Detective', rank: 85 }, { name: 'Male Protagonist', rank: 92 }, { name: 'Iyashikei', rank: 45 }] },
  { name: 'One Piece', score: 80, status: 'CURRENT', year: 1999, completed: null, genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'], tags: [{ name: 'Pirates', rank: 98 }, { name: 'Shounen', rank: 96 }, { name: 'Ensemble Cast', rank: 90 }, { name: 'Super Power', rank: 85 }] },
  { name: 'Kusuriya no Hitorigoto', score: 0, status: 'CURRENT', year: 2023, completed: null, genres: ['Drama', 'Mystery'], tags: [{ name: 'Medicine', rank: 93 }, { name: 'Female Protagonist', rank: 96 }, { name: 'Detective', rank: 80 }, { name: 'Historical', rank: 85 }] },
  { name: 'Gintama', score: 70, status: 'PAUSED', year: 2006, completed: null, genres: ['Action', 'Comedy', 'Sci-Fi'], tags: [{ name: 'Parody', rank: 96 }, { name: 'Samurai', rank: 90 }, { name: 'Episodic', rank: 80 }, { name: 'Shounen', rank: 88 }, { name: 'Male Protagonist', rank: 90 }] },
  { name: 'Detective Conan', score: 0, status: 'PAUSED', year: 1996, completed: null, genres: ['Adventure', 'Comedy', 'Mystery'], tags: [{ name: 'Detective', rank: 98 }, { name: 'Episodic', rank: 93 }, { name: 'Male Protagonist', rank: 95 }, { name: 'Shounen', rank: 80 }] },
  { name: 'Boruto: Naruto Next Generations', score: 30, status: 'DROPPED', year: 2017, completed: null, genres: ['Action', 'Adventure'], tags: [{ name: 'Ninja', rank: 97 }, { name: 'Shounen', rank: 94 }, { name: 'Male Protagonist', rank: 93 }, { name: 'Super Power', rank: 80 }] },
  { name: 'Mahouka Koukou no Rettousei', score: 0, status: 'DROPPED', year: null, completed: null, genres: ['Action', 'Fantasy', 'Romance', 'Sci-Fi'], tags: [{ name: 'Magic', rank: 95 }, { name: 'School', rank: 90 }, { name: 'Male Protagonist', rank: 93 }, { name: 'Overpowered Main Characters', rank: 88 }] },
  { name: 'Akira', score: 60, status: 'PLANNING', year: 1988, completed: null, genres: ['Action', 'Sci-Fi'], tags: [{ name: 'Cyberpunk', rank: 95 }, { name: 'Dystopian', rank: 90 }] },
  { name: 'Chainsaw Man', score: 0, status: 'PLANNING', year: 2022, completed: null, genres: ['Action', 'Horror'], tags: [{ name: 'Devils', rank: 96 }, { name: 'Gore', rank: 90 }] },
  // Sequels and more by the same studios, so Top Studios has franchises and enough entries per studio to rank (#93).
  { name: 'Mob Psycho 100 II', score: 90, status: 'COMPLETED', year: 2019, completed: 2019, genres: ['Action', 'Comedy', 'Supernatural'], tags: [{ name: 'Psychic Powers', rank: 95 }, { name: 'Male Protagonist', rank: 94 }] },
  { name: 'Mob Psycho 100 III', score: 80, status: 'COMPLETED', year: 2022, completed: 2023, genres: ['Action', 'Comedy', 'Supernatural'], tags: [{ name: 'Psychic Powers', rank: 95 }, { name: 'Coming of Age', rank: 85 }] },
  { name: 'Kaguya-sama wa Kokurasetai?: Tensai-tachi no Renai Zunousen', score: 100, status: 'COMPLETED', year: 2020, completed: 2020, genres: ['Comedy', 'Psychological', 'Romance'], tags: [{ name: 'Rom-Com', rank: 94 }, { name: 'Student Council', rank: 96 }] },
  { name: 'Kaguya-sama wa Kokurasetai: Ultra Romantic', score: 100, status: 'COMPLETED', year: 2022, completed: 2022, genres: ['Comedy', 'Psychological', 'Romance'], tags: [{ name: 'Rom-Com', rank: 94 }, { name: 'Student Council', rank: 96 }] },
  { name: 'Steins;Gate 0', score: 70, status: 'COMPLETED', year: 2018, completed: 2018, genres: ['Drama', 'Sci-Fi', 'Thriller'], tags: [{ name: 'Time Manipulation', rank: 95 }, { name: 'Alternate Universe', rank: 88 }] },
  { name: 'Vinland Saga Season 2', score: 90, status: 'COMPLETED', year: 2023, completed: 2023, genres: ['Action', 'Adventure', 'Drama'], tags: [{ name: 'Vikings', rank: 95 }, { name: 'Agriculture', rank: 90 }] },
  { name: 'Jujutsu Kaisen', score: 70, status: 'COMPLETED', year: 2020, completed: 2021, genres: ['Action', 'Drama', 'Supernatural'], tags: [{ name: 'Curses', rank: 95 }, { name: 'Shounen', rank: 94 }] },
  { name: 'Jujutsu Kaisen 2nd Season', score: 80, status: 'COMPLETED', year: 2023, completed: 2023, genres: ['Action', 'Drama', 'Supernatural'], tags: [{ name: 'Curses', rank: 95 }, { name: 'Shounen', rank: 94 }] },
  { name: 'Dorohedoro', score: 0, status: 'DROPPED', year: 2020, completed: null, genres: ['Action', 'Comedy', 'Fantasy', 'Horror'], tags: [{ name: 'Gore', rank: 90 }, { name: 'Magic', rank: 85 }] },
  { name: 'Tokyo Ghoul √A', score: 40, status: 'COMPLETED', year: 2015, completed: 2015, genres: ['Action', 'Drama', 'Horror'], tags: [{ name: 'Gore', rank: 88 }, { name: 'Tragedy', rank: 75 }] },
  { name: 'Hibike! Euphonium', score: 80, status: 'COMPLETED', year: 2015, completed: 2016, genres: ['Drama', 'Music'], tags: [{ name: 'Band', rank: 96 }, { name: 'School Club', rank: 94 }] },
  { name: 'Koe no Katachi', score: 90, status: 'COMPLETED', year: 2016, completed: 2017, genres: ['Drama', 'Romance'], tags: [{ name: 'Disability', rank: 96 }, { name: 'Bullying', rank: 94 }] },
  { name: 'One Punch Man', score: 80, status: 'COMPLETED', year: 2015, completed: 2016, genres: ['Action', 'Comedy', 'Sci-Fi'], tags: [{ name: 'Superhero', rank: 97 }, { name: 'Parody', rank: 90 }] },
  { name: 'Shingeki no Kyojin Season 3 Part 2', score: 100, status: 'COMPLETED', year: 2019, completed: 2019, genres: ['Action', 'Drama', 'Fantasy', 'Mystery'], tags: [{ name: 'Military', rank: 92 }, { name: 'Twist Ending', rank: 88, spoiler: true }] },
]

/** What Top Studios reads about a title besides its score and status (#93). Studio ids are the fake's own. */
type StudioFacts = {
  /** Main studios. */
  by: string[]
  /** Credited, but not as a main studio: Top Studios must leave these out. */
  alsoCredited?: string[]
  /** The title this one is the sequel of: the two join into one franchise. */
  sequelOf?: string
  favourite?: true
  progress?: number
  repeat?: number
  episodes?: number
  /** Minutes per episode. */
  duration?: number
}

/**
 * The fixed list's studios, franchises and favourites, by title. Picked so Top Studios shows a real ranking with
 * several labels, too few studios with six entries (the gate steps down) and small studios on the watchlist; unscored
 * favourites, drops and a rewatch count too, and Aniplex, never a main studio here, must not show up.
 */
const STUDIO_FACTS: Readonly<Record<string, StudioFacts>> = {
  'Fullmetal Alchemist: Brotherhood': { by: ['Bones'], alsoCredited: ['Aniplex'], favourite: true, episodes: 64 },
  'Steins;Gate': { by: ['White Fox'], episodes: 24 },
  'Hunter x Hunter (2011)': { by: ['Madhouse'], episodes: 148 },
  'Mob Psycho 100': { by: ['Bones'], favourite: true },
  'Sousou no Frieren': { by: ['Madhouse'], alsoCredited: ['Aniplex'], favourite: true, episodes: 28 },
  Monster: { by: ['Madhouse'], episodes: 74 },
  'Cowboy Bebop': { by: ['Sunrise'], episodes: 26 },
  'Violet Evergarden': { by: ['Kyoto Animation'], episodes: 13 },
  'Vinland Saga': { by: ['Wit Studio'], episodes: 24 },
  'Haikyuu!!': { by: ['Production I.G'], episodes: 25 },
  'Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen': { by: ['A-1 Pictures'], alsoCredited: ['Aniplex'] },
  Mushishi: { by: ['Artland'], episodes: 26 },
  'Spy x Family': { by: ['Wit Studio', 'CloverWorks'], episodes: 25 },
  'Kimetsu no Yaiba': { by: ['ufotable'], alsoCredited: ['Aniplex'], episodes: 26 },
  'Dr. Stone': { by: ['TMS Entertainment'], episodes: 24 },
  'Yuru Camp': { by: ['C-Station'] },
  'K-On!': { by: ['Kyoto Animation'], episodes: 13 },
  'Bocchi the Rock!': { by: ['CloverWorks'], alsoCredited: ['Aniplex'] },
  'Sword Art Online': { by: ['A-1 Pictures'], alsoCredited: ['Aniplex'], episodes: 25 },
  'Fairy Tail': { by: ['A-1 Pictures', 'Satelight'], episodes: 175 },
  'Tokyo Ghoul': { by: ['Pierrot'] },
  'Black Clover': { by: ['Pierrot'], episodes: 170 },
  'Nanatsu no Taizai': { by: ['A-1 Pictures'], episodes: 24 },
  'Boku no Hero Academia': { by: ['Bones'], episodes: 13 },
  'Dungeon Meshi': { by: ['Trigger'], episodes: 24 },
  'Odd Taxi': { by: ['OLM', 'P.I.C.S.'], episodes: 13 },
  'Ping Pong the Animation': { by: ['Tatsunoko Production'], episodes: 11 },
  'Tensei Shitara Slime Datta Ken': { by: ['8bit'], episodes: 24 },
  'Shingeki no Kyojin': { by: ['Wit Studio'], favourite: true, episodes: 25 },
  'Made in Abyss': { by: ['Kinema Citrus'], episodes: 13 },
  'Neon Genesis Evangelion': { by: ['Gainax'], alsoCredited: ['Tatsunoko Production'], favourite: true, repeat: 2, progress: 12, episodes: 26 },
  Hyouka: { by: ['Kyoto Animation'], progress: 8, episodes: 22 },
  'One Piece': { by: ['Toei Animation'], progress: 1100, episodes: 0 },
  'Kusuriya no Hitorigoto': { by: ['TOHO animation', 'OLM'], progress: 10, episodes: 24 },
  Gintama: { by: ['Sunrise'], progress: 150, episodes: 201 },
  'Detective Conan': { by: ['TMS Entertainment'], progress: 300, episodes: 0 },
  'Boruto: Naruto Next Generations': { by: ['Pierrot'], progress: 40, episodes: 293 },
  'Mahouka Koukou no Rettousei': { by: ['Madhouse'], progress: 3, episodes: 26 },
  Akira: { by: ['TMS Entertainment'], episodes: 1, duration: 124 },
  'Chainsaw Man': { by: ['MAPPA'] },
  'Mob Psycho 100 II': { by: ['Bones'], sequelOf: 'Mob Psycho 100', favourite: true, episodes: 13 },
  'Mob Psycho 100 III': { by: ['Bones'], sequelOf: 'Mob Psycho 100 II' },
  'Kaguya-sama wa Kokurasetai?: Tensai-tachi no Renai Zunousen': { by: ['A-1 Pictures'], alsoCredited: ['Aniplex'], sequelOf: 'Kaguya-sama wa Kokurasetai: Tensai-tachi no Renai Zunousen' },
  'Kaguya-sama wa Kokurasetai: Ultra Romantic': { by: ['A-1 Pictures'], alsoCredited: ['Aniplex'], sequelOf: 'Kaguya-sama wa Kokurasetai?: Tensai-tachi no Renai Zunousen', episodes: 13 },
  'Steins;Gate 0': { by: ['White Fox'], sequelOf: 'Steins;Gate', episodes: 23 },
  'Vinland Saga Season 2': { by: ['MAPPA'], sequelOf: 'Vinland Saga', episodes: 24 },
  'Jujutsu Kaisen': { by: ['MAPPA'], episodes: 24 },
  'Jujutsu Kaisen 2nd Season': { by: ['MAPPA'], sequelOf: 'Jujutsu Kaisen', episodes: 23 },
  Dorohedoro: { by: ['MAPPA'], progress: 2 },
  'Tokyo Ghoul √A': { by: ['Pierrot'], sequelOf: 'Tokyo Ghoul' },
  'Hibike! Euphonium': { by: ['Kyoto Animation'], episodes: 13 },
  'Koe no Katachi': { by: ['Kyoto Animation'], episodes: 1, duration: 130 },
  'One Punch Man': { by: ['Madhouse'] },
  'Shingeki no Kyojin Season 3 Part 2': { by: ['Wit Studio'], sequelOf: 'Shingeki no Kyojin', episodes: 10 },
}

/** The fake has no cover images; Top Studios shows a title's cover colour in their place. */
const COVER_COLORS = ['#e4a15d', '#5da1e4', '#e45d86', '#5de4a1', '#a15de4', '#e4d65d', '#5dd6e4', '#e4765d']

const idOf = (name: string) => FIXED_LIST.findIndex((t) => t.name === name) + 1
const studioNames = [...new Set(Object.values(STUDIO_FACTS).flatMap((f) => [...f.by, ...(f.alsoCredited ?? [])]))]

/** A title's release year, completion date, genres, tags and what Top Studios reads, as the fake AniList answers them. */
function mediaOf({ name, year, completed, genres, tags }: FixedTitle): FakeMedia {
  const { by, alsoCredited = [], sequelOf, progress, repeat, episodes, duration } = STUDIO_FACTS[name]
  const studio = (isMain: boolean) => (studioName: string) => ({ id: studioNames.indexOf(studioName) + 1, name: studioName, isMain })
  const sequels = Object.keys(STUDIO_FACTS).filter((other) => STUDIO_FACTS[other].sequelOf === name)
  return {
    year,
    completedAt: completed === null ? null : { year: completed, month: 6, day: 1 },
    genres,
    tags: tags.map(({ name, rank, spoiler = false }) => ({ name, rank, spoiler })),
    progress,
    repeat,
    episodes,
    duration,
    coverColor: COVER_COLORS[idOf(name) % COVER_COLORS.length],
    studios: [...by.map(studio(true)), ...alsoCredited.map(studio(false))],
    relations: [
      ...(sequelOf ? [{ relationType: 'PREQUEL', mediaId: idOf(sequelOf) }] : []),
      ...sequels.map((sequel) => ({ relationType: 'SEQUEL', mediaId: idOf(sequel) })),
    ],
  }
}

/** A fresh fake AniList holding the fixed list, viewed by Fake Zen. */
function fixedAniList(clock: Clock) {
  const byId = <T>(pick: (title: FixedTitle) => T) => Object.fromEntries(FIXED_LIST.map((title, i) => [i + 1, pick(title)]))
  const aniList = fakeAniList(clock, byId((t) => t.score), {
    statuses: byId((t) => t.status),
    titles: byId((t) => t.name),
    media: byId(mediaOf),
    favourites: FIXED_LIST.filter((t) => STUDIO_FACTS[t.name].favourite).map((t) => idOf(t.name)),
  })
  // No real account has id 0, so nothing saved for one is touched.
  Object.assign(aniList.viewer, { id: 0, name: 'Fake Zen' })
  return aniList
}

/**
 * A session on a fresh fake AniList: every page load starts from the fixed list again, and writes go to the fake only.
 * What an earlier fake session saved in `storage` is thrown away with it, so the app opens on Start.
 */
export function fakeSession(storage: Storage, clock: Clock = browserClock): AniListSession {
  const aniList = fixedAniList(clock)
  deleteSavedProgress(storage, aniList.viewer.id)
  return { fetch: aniList.fetch, token: 'fake' }
}

/**
 * The Top Studios page on the same fake AniList (#93): logged in as Fake Zen, whose list it ranks; any other name is
 * no such user. Top Studios saves nothing, so there is nothing to throw away.
 */
export function fakeStudiosSession(clock: Clock = browserClock): AniListSession {
  return { fetch: fixedAniList(clock).fetch, token: 'fake' }
}
