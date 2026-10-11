// Which screen shows: one answer from the screen name and the state it depends on (#59, ADR 0004).
import { describe, expect, it } from 'vitest'
import type { Viewer } from '../anilist/types.ts'
import type { ImportView } from '../import/previewImport.ts'
import { appendEvent, replay, startLog, startNewTitlesLog, type BandIndex, type DuelLog, type LogEvent } from '../ranking/engine.ts'
import { SPLIT_OFFER_THRESHOLD } from '../ranking/split.ts'
import { rankingLogOf } from '../ranking/testRanking.ts'
import { NO_RANKING_UI } from './rankingUi.ts'
import { SCREENS, rankingShown, shownScreen, splitBandOf, type ScreenInput } from './shownScreen.ts'

const viewer: Viewer = { id: 7, name: 'zen', avatarUrl: null, titleLanguage: 'ROMAJI', scoreFormat: 'POINT_10' }
const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

const plus = (log: DuelLog, ...events: LogEvent[]): DuelLog => events.reduce(appendEvent, log)
const logOf = (ids: number[], ...events: LogEvent[]): DuelLog => plus(startLog({ ...header, ids }), ...events)
const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })

/** Logged in, the list loaded, nothing else going on: the Ranking screen of `log` (no log = no Ranking). */
function at(log: DuelLog | null, change: Partial<ScreenInput> = {}): ScreenInput {
  return {
    screen: 'ranking',
    viewer,
    log,
    ranking: log && replay(log),
    listLoaded: true,
    notice: false,
    oldScores: new Map(),
    rankingUi: NO_RANKING_UI,
    preview: null,
    importing: null,
    ...change,
  }
}

const kindAt = (log: DuelLog | null, change?: Partial<ScreenInput>) => shownScreen(at(log, change)).kind

/** Continue was pressed on the last check. */
const continued = { ...NO_RANKING_UI, lastCheckContinued: true }

/** Titles 1, 2 and 3 all Loved, Rough Sort done. */
const sorted = () => logOf([1, 2, 3], assign(1, 0), assign(2, 0), assign(3, 0))

describe('Start', () => {
  it('shows without a login, whatever screen name is set', () => {
    for (const screen of SCREENS) expect(kindAt(sorted(), { screen, viewer: null })).toBe('start')
  })
})

/** Score New Titles: new title 1 against Anchors on 8 and 6. */
const newTitles = () =>
  startNewTitlesLog({ ...header, format: 'POINT_10', anchors: [{ id: 101, level: 8 }, { id: 102, level: 6 }], ids: [1] })

/** Answers Anchor Duels until the closer-to prompt: the new title beats the Anchor on 6 and loses to the one on 8. */
function toCloserTo(log: DuelLog): DuelLog {
  for (let state = replay(log); state.prompt.kind !== 'closer-to'; state = replay(log)) {
    const p = state.prompt
    if (p.kind !== 'anchor-duel') throw new Error(`unexpected ${p.kind}`)
    log = plus(log, { type: 'duel-answered', a: p.a, b: p.b, result: p.b === 102 ? 'a' : 'b' })
  }
  return log
}

describe("the Ranking screen follows the engine's next prompt", () => {
  it('Rough Sort while titles have no Band', () => {
    expect(kindAt(logOf([1, 2], assign(1, 0)))).toBe('rough-sort')
  })

  it('the Band choice when the engine asks which Band comes next', () => {
    const twoBands = logOf([1, 2, 3, 4], assign(1, 0), assign(2, 0), assign(3, 1), assign(4, 1))
    const shown = shownScreen(at(twoBands, { rankingUi: continued }))
    expect(shown.kind).toBe('band-choice')
  })

  it('a Duel once a Band is chosen', () => {
    const chosen = plus(sorted(), { type: 'band-selected', band: 0 })
    expect(kindAt(chosen, { rankingUi: continued })).toBe('duel')
  })

  it('the Band choice over a Duel when it was opened from the Duel or the menu', () => {
    const chosen = plus(sorted(), { type: 'band-selected', band: 0 })
    expect(kindAt(chosen, { screen: 'bands', rankingUi: continued })).toBe('band-choice')
  })

  it('a Duel against an Anchor under Score New Titles, also when the Band choice is asked for', () => {
    expect(kindAt(newTitles())).toBe('duel')
    expect(kindAt(newTitles(), { screen: 'bands' })).toBe('duel')
  })

  it('the Closer-to prompt for a new title between two scores', () => {
    expect(kindAt(toCloserTo(newTitles()))).toBe('closer-to')
  })

  it('the finished Ranking', () => {
    expect(kindAt(rankingLogOf([[[1], [2]], [], [], [], []]))).toBe('complete')
  })

  it('whatever in-Ranking screen name is set, when that screen has nothing to show', () => {
    for (const screen of ['bands', 'board', 'preview', 'import'] as const) {
      expect(kindAt(rankingLogOf([[[1], [2]], [], [], [], []]), { screen })).toBe('complete')
    }
  })
})

describe('Start: no usable Ranking', () => {
  it('shows when no Ranking is saved, whatever screen name is set', () => {
    for (const screen of SCREENS) if (screen !== 'catchup') expect(kindAt(null, { screen })).toBe('start')
  })

  it('shows when the screen name is Start, with a Ranking saved', () => {
    expect(kindAt(sorted(), { screen: 'start' })).toBe('start')
  })

  it('shows while the list is loading, and the Ranking shows without it under a banner', () => {
    expect(kindAt(sorted(), { listLoaded: false })).toBe('start')
    expect(kindAt(sorted(), { listLoaded: false, notice: true })).not.toBe('start')
  })
})

describe('the Board', () => {
  it('shows when opened from Rough Sort, while it is open', () => {
    expect(kindAt(logOf([1, 2], assign(1, 0)), { screen: 'board' })).toBe('board')
  })

  it('is the last check after Rough Sort, until Continue', () => {
    expect(kindAt(sorted())).toBe('last-check')
    expect(kindAt(sorted(), { screen: 'bands' })).toBe('last-check')
    expect(kindAt(sorted(), { rankingUi: continued })).not.toBe('last-check')
  })

  it('is not the last check once a Duel was answered, also without Continue', () => {
    const p = replay(sorted()).prompt
    if (p.kind !== 'duel') throw new Error(`unexpected ${p.kind}`)
    const answered = plus(sorted(), { type: 'duel-answered', a: p.a, b: p.b, result: 'a' })
    expect(kindAt(answered)).toBe('duel')
    expect(kindAt(answered, { screen: 'board' })).toBe('duel')
  })
})

describe('a split offer', () => {
  const ids = Array.from({ length: SPLIT_OFFER_THRESHOLD + 5 }, (_, i) => i + 1)
  /** A Loved Band big enough for a split offer, Rough Sort just done. */
  const oversized = () => logOf(ids, ...ids.map((id) => assign(id, 0)))

  it('shows on its own after Rough Sort, before the last check', () => {
    expect(shownScreen(at(oversized()))).toMatchObject({ kind: 'split', band: 0, lastCheckNext: true })
    expect(shownScreen(at(oversized(), { rankingUi: continued }))).toMatchObject({ kind: 'split', band: 0, lastCheckNext: false })
  })

  it('gives way to the last check once it was turned down', () => {
    expect(kindAt(oversized(), { rankingUi: { ...NO_RANKING_UI, skippedSplits: [0] } })).toBe('last-check')
  })

  it('does not show on its own once a Duel was answered, but the menu still opens the Split screen', () => {
    const p = replay(oversized()).prompt
    if (p.kind !== 'duel') throw new Error(`unexpected ${p.kind}`)
    const answered = plus(oversized(), { type: 'duel-answered', a: p.a, b: p.b, result: 'a' })
    expect(kindAt(answered)).toBe('duel')
    expect(shownScreen(at(answered, { rankingUi: { ...NO_RANKING_UI, splitView: { band: 0 } } }))).toMatchObject({ kind: 'split', band: 0 })
  })

  it('names the same Band for the sidebar', () => {
    const log = oversized()
    expect(splitBandOf(replay(log), log, NO_RANKING_UI)).toBe(0)
    expect(splitBandOf(replay(log), log, { ...NO_RANKING_UI, skippedSplits: [0] })).toBeNull()
    expect(splitBandOf(replay(sorted()), sorted(), { ...NO_RANKING_UI, splitView: { band: 2 } })).toBe(2)
  })
})

/** Titles 1 over 2 in Loved, finished on Scores: its scoring settings are in the log, on POINT_10. */
const finished = () => rankingLogOf([[[1], [2]], [], [], [], []], [], 'POINT_10')
const checked = { format: 'POINT_10' as const, converted: false }

describe('Preview', () => {
  it('shows for a finished Ranking after the fresh Viewer check', () => {
    const shown = shownScreen(at(finished(), { screen: 'preview', preview: checked }))
    expect(shown.kind).toBe('preview')
    expect(shown).toMatchObject({ scoring: replay(finished()).scoring?.settings })
  })

  it('shows before the end under Score New Titles', () => {
    expect(kindAt(newTitles(), { screen: 'preview', preview: checked })).toBe('preview')
  })

  it('asked for without the fresh Viewer check shows the Ranking screen', () => {
    expect(kindAt(finished(), { screen: 'preview' })).toBe('complete')
  })

  it("asked for on a Ranking that can't have it shows the Ranking screen", () => {
    const chosen = plus(sorted(), { type: 'band-selected', band: 0 })
    expect(kindAt(chosen, { screen: 'preview', preview: checked, rankingUi: continued })).toBe('duel')
  })

  it('waits for the old scores, and for scoring settings on the Score Format AniList reports now', () => {
    expect(kindAt(finished(), { screen: 'preview', preview: checked, oldScores: null })).toBe('complete')
    const changed = { ...viewer, scoreFormat: 'POINT_100' as const }
    expect(kindAt(finished(), { screen: 'preview', preview: { format: 'POINT_100', converted: true }, viewer: changed })).toBe('complete')
  })
})

/** An Import with nothing to write, at the given stage. */
const importOn = (stage: ImportView['stage']): ImportView => ({
  stage,
  state: { hash: 'h', format: 'POINT_10', writes: [] },
  status: null,
  writtenBefore: null,
})

describe('Import', () => {
  it('shows over the open Ranking at every step', () => {
    for (const stage of ['confirm', 'running', 'stopped', 'done'] as const) {
      const shown = shownScreen(at(finished(), { screen: 'import', importing: importOn(stage) }))
      expect(shown).toMatchObject({ kind: 'import', importing: { stage } })
      expect(shown).not.toMatchObject({ ranking: null })
    }
  })

  it('shows only when asked for', () => {
    expect(kindAt(finished(), { importing: importOn('running') })).toBe('complete')
  })

  it('finished for a Score New Titles Ranking shows its summary with no Ranking left', () => {
    expect(shownScreen(at(null, { screen: 'import', importing: importOn('done') }))).toMatchObject({ kind: 'import', ranking: null, importing: { stage: 'done' } })
    // The list is not waited for: only the summary shows.
    expect(kindAt(null, { screen: 'import', importing: importOn('done'), listLoaded: false })).toBe('import')
  })

  it('unfinished with no Ranking left shows Start', () => {
    expect(kindAt(null, { screen: 'import', importing: importOn('stopped') })).toBe('start')
  })

  it('dropped shows the Ranking screen', () => {
    const dropped = { stage: 'dropped' as const, reason: 'nothing-left' as const, format: 'POINT_10' as const, previewOpen: true }
    expect(kindAt(finished(), { screen: 'import', importing: dropped })).toBe('complete')
  })
})

describe('Catch-up', () => {
  it('shows once logged in, with or without a Ranking and before the list is loaded', () => {
    expect(kindAt(sorted(), { screen: 'catchup' })).toBe('catch-up')
    expect(kindAt(null, { screen: 'catchup', listLoaded: false })).toBe('catch-up')
  })
})

describe('the sidebar', () => {
  it('shows beside every screen of the open Ranking, Preview and Import too', () => {
    const preview = shownScreen(at(finished(), { screen: 'preview', preview: checked }))
    const importing = shownScreen(at(finished(), { screen: 'import', importing: importOn('running') }))
    for (const shown of [shownScreen(at(sorted())), preview, importing]) expect(rankingShown(shown)).toMatchObject({ viewer })
  })

  it('does not show on Start, in Catch-up, or once the Ranking ended with its Import', () => {
    expect(rankingShown(shownScreen(at(sorted(), { screen: 'start' })))).toBeNull()
    expect(rankingShown(shownScreen(at(sorted(), { screen: 'catchup' })))).toBeNull()
    expect(rankingShown(shownScreen(at(null, { screen: 'import', importing: importOn('done') })))).toBeNull()
  })
})
