// The dev-only fake session (#68): the app signed in against a fake AniList, with a list that reaches every Sort Goal.
import { describe, expect, it } from 'vitest'
import { createAniListGateway } from '../anilist/gateway.ts'
import { fakeClock } from '../anilist/fakeAniList.ts'
import { memoryStorage } from '../persistence/memoryStorage.ts'
import { loadLastMediaType, saveLastMediaType } from '../persistence/progress.ts'
import { DEFAULT_STATUSES, OFFERED_STATUSES } from '../pool/pool.ts'
import { KEEP_MY_SCALE } from '../ranking/engine.ts'
import { startView } from '../ui/start/startView.ts'
import { fakeSession } from './fakeSession.ts'

async function signedIn() {
  const gateway = createAniListGateway(fakeSession(memoryStorage(), fakeClock()))
  const viewer = await gateway.viewer()
  const list = await gateway.mediaList({ userId: viewer.id, type: 'ANIME', statuses: OFFERED_STATUSES })
  return { gateway, viewer, list }
}

describe('the fake session', () => {
  it('answers Viewer and the list without a login', async () => {
    const { viewer, list } = await signedIn()
    expect(viewer.name).toBe('Fake Zen')
    expect(list.length).toBeGreaterThan(0)
  })

  it('has titles with and without a score in every offered status, each with its own name', async () => {
    const { list } = await signedIn()
    for (const status of OFFERED_STATUSES) {
      const scores = list.filter((e) => e.status === status).map((e) => e.oldScore100 > 0)
      expect(scores, status).toContain(true)
      expect(scores, status).toContain(false)
    }
    expect(new Set(list.map((e) => e.title.romaji)).size).toBe(list.length)
  })

  it("gives titles release years, completion dates, genres and tags, spoiler and weak tags among them, for the Picker's filters", async () => {
    const { list } = await signedIn()
    expect(new Set(list.flatMap((e) => (e.year === null ? [] : [e.year]))).size).toBeGreaterThan(5)
    expect(list.some((e) => e.year === null)).toBe(true)
    expect(list.filter((e) => e.completedAt.year !== null).length).toBeGreaterThan(5)
    expect(new Set(list.flatMap((e) => e.genres ?? [])).size).toBeGreaterThan(5)
    const tags = list.flatMap((e) => e.tags ?? [])
    expect(tags.some((t) => t.spoiler)).toBe(true)
    expect(tags.some((t) => t.rank < 50)).toBe(true)
    expect(new Set(tags.filter((t) => !t.spoiler && t.rank >= 50).map((t) => t.name)).size).toBeGreaterThan(10)
  })

  it('offers Keep My Scale, with unscored titles to pick under the default statuses', async () => {
    const { viewer, list } = await signedIn()
    const start = startView({
      list,
      statuses: DEFAULT_STATUSES,
      scoreFormat: viewer.scoreFormat,
      titleLanguage: viewer.titleLanguage,
      saved: null,
      savedBroken: false,
      picked: KEEP_MY_SCALE,
    })
    expect(start.eligibility).toMatchObject({ eligible: true })
    expect(start.newGoal).toBe(KEEP_MY_SCALE)
    expect(start.form.mainAction).toBe('choose-titles')
    expect(start.form.keepMyScale.count).toBeGreaterThan(0)
  })

  it('throws away what an earlier fake session saved in this browser, and nothing of another user', async () => {
    const storage = memoryStorage()
    const viewer = await createAniListGateway(fakeSession(storage, fakeClock())).viewer()
    saveLastMediaType(storage, viewer.id, 'MANGA')
    saveLastMediaType(storage, viewer.id + 1, 'MANGA')
    fakeSession(storage, fakeClock())
    expect(loadLastMediaType(storage, viewer.id)).toBeNull()
    expect(loadLastMediaType(storage, viewer.id + 1)).toBe('MANGA')
  })

  it('keeps an imported score in the fake, so the next list read shows it', async () => {
    const { gateway, viewer, list } = await signedIn()
    const unscored = list.find((e) => e.oldScore100 === 0)!
    await gateway.saveScore(unscored.mediaId, 80)
    const after = await gateway.mediaList({ userId: viewer.id, type: 'ANIME', statuses: OFFERED_STATUSES })
    expect(after.find((e) => e.mediaId === unscored.mediaId)!.oldScore100).toBe(80)
  })
})
