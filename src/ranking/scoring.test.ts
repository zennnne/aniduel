import { describe, expect, it } from 'vitest'
import type { RankingState } from './engine.ts'
import { allowedLevels, changeSettings, convertSettings, defaultSettings, formatLevel, hasHumanStep, levelOfRaw, isFirstCustomPick, levels, movedTitles, parseSavedScoring, score, settingsFor, stepLabel, withStep, type ScoreStep, type ScoringSettings, type SettingsChange } from './scoring.ts'
import { rankingOf as ranking } from './testRanking.ts'

const levelsOf = (state: RankingState, ...args: Parameters<typeof score> extends [unknown, ...infer R] ? R : never) => {
  const result = score(state, ...args)
  return [...result.titles.entries()].sort((x, y) => x[0] - y[0]).map(([, t]) => t.level)
}

describe('Linear', () => {
  it('maps the first title to best and the last to worst in a straight line', () => {
    const state = ranking([[[1], [2], [3], [4], [5]]])
    expect(levelsOf(state, 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 2 })).toEqual([10, 8, 6, 4, 2])
  })
})

/** [level, scoreRaw] per title, in title id order. */
const scored = (state: RankingState, ...args: Parameters<typeof score> extends [unknown, ...infer R] ? R : never) =>
  [...score(state, ...args).titles.entries()].sort((x, y) => x[0] - y[0]).map(([, t]) => [t.level, t.scoreRaw])

describe('Score Formats (ADR 0003: a level and the exact scoreRaw AniList stores for it)', () => {
  const four = () => ranking([[[1], [2], [3], [4]]])
  const five = () => ranking([[[1], [2], [3], [4], [5]]])

  it('100 point', () => {
    expect(scored(five(), 'POINT_100', { distribution: 'linear', step: 'fine', best: 90, worst: 30 })).toEqual([
      [90, 90], [75, 75], [60, 60], [45, 45], [30, 30],
    ])
    // mid 50, σ 20: 50 ± 23.01, 50 ± 6.37
    expect(scored(four(), 'POINT_100', { distribution: 'bell', step: 'fine', best: 90, worst: 10 })).toEqual([
      [73, 73], [56, 56], [44, 44], [27, 27],
    ])
  })

  it('10 point decimal', () => {
    expect(scored(four(), 'POINT_10_DECIMAL', { distribution: 'linear', step: 'fine', best: 9.5, worst: 2 })).toEqual([
      [9.5, 95], [7, 70], [4.5, 45], [2, 20],
    ])
    // mid 5, σ 2: 7.30, 5.64, 4.36, 2.70
    expect(scored(four(), 'POINT_10_DECIMAL', { distribution: 'bell', step: 'fine', best: 9, worst: 1 })).toEqual([
      [7.3, 73], [5.6, 56], [4.4, 44], [2.7, 27],
    ])
  })

  it('10 point', () => {
    expect(scored(five(), 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 2 })).toEqual([
      [10, 100], [8, 80], [6, 60], [4, 40], [2, 20],
    ])
    expect(scored(four(), 'POINT_10', { distribution: 'bell', step: 'fine', best: 10, worst: 2 })).toEqual([
      [8, 80], [7, 70], [5, 50], [4, 40],
    ])
  })

  it('5 stars sends 10 / 30 / 50 / 70 / 90', () => {
    expect(scored(five(), 'POINT_5', { distribution: 'linear', step: 'fine', best: 5, worst: 1 })).toEqual([
      [5, 90], [4, 70], [3, 50], [2, 30], [1, 10],
    ])
    // mid 3, σ 1: 4.15, 3.32, 2.68, 1.85
    expect(scored(four(), 'POINT_5', { distribution: 'bell', step: 'fine', best: 5, worst: 1 })).toEqual([
      [4, 70], [3, 50], [3, 50], [2, 30],
    ])
  })

  it('3 smileys sends 35 / 60 / 85', () => {
    expect(scored(ranking([[[1], [2], [3]]]), 'POINT_3', { distribution: 'linear', step: 'fine', best: 3, worst: 1 })).toEqual([
      [3, 85], [2, 60], [1, 35],
    ])
    // mid 2, σ 0.5: 2.58, 2.16, 1.84, 1.42
    expect(scored(four(), 'POINT_3', { distribution: 'bell', step: 'fine', best: 3, worst: 1 })).toEqual([
      [3, 85], [2, 60], [2, 60], [1, 35],
    ])
  })

  it('never gives the worst title 0 ("no score"), even if asked to', () => {
    const levels = scored(five(), 'POINT_10', { distribution: 'linear', step: 'fine', best: 8, worst: 0 })
    expect(levels.at(-1)).toEqual([1, 10])
    expect(levels.every(([, raw]) => raw > 0)).toBe(true)
  })
})

describe('Tiers', () => {
  it('gives every title in a Tier the score of the Tier average position', () => {
    // Positions 0, (1, 2), 3: the Tier sits at 1.5 → 10 − 1.5 × 2 = 7.
    const state = ranking([[[1], [2, 3], [4]]])
    expect(levelsOf(state, 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 4 })).toEqual([10, 7, 7, 4])
  })

  it('leaves Forgotten titles out: they get no score and take no position', () => {
    const state = ranking([[[1], [2], [3]]], [9])
    const { titles } = score(state, 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 4 })
    expect(titles.has(9)).toBe(false)
    expect([1, 2, 3].map((id) => titles.get(id)?.level)).toEqual([10, 7, 4])
  })

  it('places the Ranking Band by Band from the top', () => {
    const state = ranking([[[4]], [[3, 2]], [], [], [[1]]])
    expect(levelsOf(state, 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 4 })).toEqual([4, 7, 7, 10])
  })
})

describe('Bell', () => {
  it('maps the percentile (position + 0.5) / N to mid + Φ⁻¹(1 − p) × (best − worst) / 4', () => {
    // mid 6, σ 2. p = .125 .375 .625 .875 → Φ⁻¹ = ±1.1503, ±0.3186 → 8.30, 6.64, 5.36, 3.70.
    const state = ranking([[[1], [2], [3], [4]]])
    expect(levelsOf(state, 'POINT_10', { distribution: 'bell', step: 'fine', best: 10, worst: 2 })).toEqual([8, 7, 5, 4])
  })

  it('clamps to best..worst', () => {
    // N = 50: p = 0.01 → Φ⁻¹(0.99) = 2.326 is beyond +2σ, so it clamps to best; the last title clamps to worst.
    const ids = Array.from({ length: 50 }, (_, i) => [i + 1])
    const levels = levelsOf(ranking([ids]), 'POINT_100', { distribution: 'bell', step: 'fine', best: 90, worst: 10 })
    expect(levels[0]).toBe(90)
    expect(levels[49]).toBe(10)
    expect(Math.max(...levels)).toBe(90)
    expect(Math.min(...levels)).toBe(10)
  })

  it('uses a Tier average position for its percentile', () => {
    // Positions (0, 1), 2, 3 → the Tier sits at 0.5: p = 0.25 → Φ⁻¹(0.75) = 0.6745 → 6 + 1.35 = 7.35.
    const state = ranking([[[1, 2], [3], [4]]])
    expect(levelsOf(state, 'POINT_10', { distribution: 'bell', step: 'fine', best: 10, worst: 2 })).toEqual([7, 7, 5, 4])
  })
})

describe('Score Format levels', () => {
  it('lists the levels a user can pick, highest first, never 0', () => {
    expect(levels('POINT_3')).toEqual([3, 2, 1])
    expect(levels('POINT_5')).toEqual([5, 4, 3, 2, 1])
    expect(levels('POINT_10')).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    const decimal = levels('POINT_10_DECIMAL')
    expect([decimal.length, decimal[0], decimal[1], decimal.at(-1)]).toEqual([100, 10, 9.9, 0.1])
    const hundred = levels('POINT_100')
    expect([hundred.length, hundred[0], hundred.at(-1)]).toEqual([100, 100, 1])
  })

  it('reads a stored raw score the way AniList shows it (0 = no score)', () => {
    expect(levelOfRaw('POINT_100', 79)).toBe(79)
    expect(levelOfRaw('POINT_10_DECIMAL', 79)).toBe(7.9)
    expect(levelOfRaw('POINT_10', 79)).toBe(7) // always rounds down
    expect([10, 29, 30, 70, 90, 100].map((raw) => levelOfRaw('POINT_5', raw))).toEqual([1, 1, 2, 4, 5, 5]) // nearest star
    expect([1, 35, 36, 60, 61, 100].map((raw) => levelOfRaw('POINT_3', raw))).toEqual([1, 1, 2, 2, 3, 3])
    expect((['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const).map((f) => levelOfRaw(f, 0))).toEqual([
      0, 0, 0, 0, 0,
    ])
  })

  it('labels a level the way the Score Format shows it', () => {
    expect(formatLevel('POINT_100', 85)).toBe('85')
    expect(formatLevel('POINT_10_DECIMAL', 7)).toBe('7.0')
    expect(formatLevel('POINT_10_DECIMAL', 7.5)).toBe('7.5')
    expect(formatLevel('POINT_10', 7)).toBe('7')
    expect(formatLevel('POINT_5', 3)).toBe('★★★')
    expect([1, 2, 3].map((n) => formatLevel('POINT_3', n))).toEqual(['🙁', '😐', '🙂'])
  })
})

describe('Scoring settings', () => {
  it('starts from a sensible best and worst for each Score Format', () => {
    expect(defaultSettings('POINT_10')).toEqual({ distribution: 'linear', step: 'human', best: 10, worst: 3 })
    expect(defaultSettings('POINT_10_DECIMAL')).toEqual({ distribution: 'linear', step: 'human', best: 10, worst: 3 })
    expect(defaultSettings('POINT_100')).toEqual({ distribution: 'linear', step: 'human', best: 95, worst: 30 })
    expect(defaultSettings('POINT_5')).toEqual({ distribution: 'linear', step: 'human', best: 5, worst: 1 })
    expect(defaultSettings('POINT_3')).toEqual({ distribution: 'linear', step: 'human', best: 3, worst: 1 })
  })

  it('converts best and worst to a new Score Format through the raw score (ADR 0003)', () => {
    const bell = { distribution: 'bell' as const, step: 'fine' as const }
    expect(convertSettings({ ...bell, best: 95, worst: 30 }, 'POINT_100', 'POINT_3')).toEqual({ ...bell, best: 3, worst: 1 })
    expect(convertSettings({ ...bell, best: 3, worst: 1 }, 'POINT_3', 'POINT_100')).toEqual({ ...bell, best: 85, worst: 35 })
    expect(convertSettings({ ...bell, best: 8.5, worst: 2.5 }, 'POINT_10_DECIMAL', 'POINT_10')).toEqual({ ...bell, best: 8, worst: 2 })
  })

  it('never converts worst to 0, and keeps worst below best', () => {
    expect(convertSettings({ distribution: 'linear', step: 'fine', best: 50, worst: 5 }, 'POINT_100', 'POINT_10')).toEqual({
      distribution: 'linear', step: 'fine', best: 5, worst: 1,
    })
    expect(convertSettings({ distribution: 'linear', step: 'fine', best: 10, worst: 9 }, 'POINT_10', 'POINT_3')).toEqual({
      distribution: 'linear', step: 'fine', best: 3, worst: 2,
    })
    expect(convertSettings({ distribution: 'linear', step: 'fine', best: 20, worst: 10 }, 'POINT_100', 'POINT_3')).toEqual({
      distribution: 'linear', step: 'fine', best: 2, worst: 1,
    })
  })
})

describe('Scoring settings for the Score Format AniList reports now', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(settingsFor(null, 'POINT_5')).toEqual({ settings: defaultSettings('POINT_5'), converted: false })
  })

  it('keeps saved settings made for the same Score Format', () => {
    const saved = { format: 'POINT_10' as const, settings: { distribution: 'bell' as const, step: 'fine' as const, best: 9, worst: 2 } }
    expect(settingsFor(saved, 'POINT_10')).toEqual({ settings: saved.settings, converted: false })
  })

  it('converts saved settings made for another Score Format and says so', () => {
    const saved = { format: 'POINT_100' as const, settings: { distribution: 'bell' as const, step: 'fine' as const, best: 95, worst: 30 } }
    expect(settingsFor(saved, 'POINT_5')).toEqual({ settings: { distribution: 'bell', step: 'fine', best: 5, worst: 2 }, converted: true })
  })
})

describe('Band level ranges (ADR 0002)', () => {
  it('gives each Band the lowest and highest level its titles get, and null for an empty Band', () => {
    const state = ranking([[[1], [2]], [[3]], [], [[4], [5]], []])
    const { bands } = score(state, 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 2 })
    expect(bands).toEqual([{ min: 8, max: 10 }, { min: 6, max: 6 }, null, { min: 2, max: 4 }, null])
  })
})

describe('Score Step', () => {
  const human = (distribution: 'linear' | 'bell', best: number, worst: number) => ({ distribution, step: 'human' as const, best, worst })

  it('gives scores every 0.5 on 10 point decimal and every 5 on 100 point', () => {
    expect(levelsOf(ranking([[[1], [2], [3], [4], [5]]]), 'POINT_10_DECIMAL', human('linear', 10, 3))).toEqual([10, 8.5, 6.5, 5, 3])
    expect(levelsOf(ranking([[[1], [2], [3], [4], [5]]]), 'POINT_100', human('linear', 95, 30))).toEqual([95, 80, 65, 45, 30])
  })

  it('lets different Tiers share a score', () => {
    const state = ranking([[[1], [2], [3], [4], [5], [6], [7]]])
    expect(levelsOf(state, 'POINT_10_DECIMAL', human('linear', 10, 9))).toEqual([10, 10, 9.5, 9.5, 9.5, 9, 9])
  })

  it('only lists levels on the Score Step, never 0', () => {
    const decimal = levels('POINT_10_DECIMAL', 'human')
    expect([decimal.length, decimal[0], decimal[1], decimal.at(-1)]).toEqual([20, 10, 9.5, 0.5])
    const hundred = levels('POINT_100', 'human')
    expect([hundred.length, hundred[0], hundred[1], hundred.at(-1)]).toEqual([20, 100, 95, 5])
    expect(levels('POINT_10', 'human')).toEqual(levels('POINT_10'))
  })

  it('is only a choice on 10 point decimal and 100 point', () => {
    expect((['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const).map(hasHumanStep)).toEqual([true, true, false, false, false])
    expect([stepLabel('POINT_10_DECIMAL', 'fine'), stepLabel('POINT_10_DECIMAL', 'human')]).toEqual(['0.1', '0.5'])
    expect([stepLabel('POINT_100', 'fine'), stepLabel('POINT_100', 'human')]).toEqual(['1', '5'])
  })

  it('moves best and worst to the nearest levels on a coarser Score Step, worst still below best', () => {
    const fine = { distribution: 'bell' as const, step: 'fine' as const }
    expect(withStep({ ...fine, best: 9.7, worst: 3.2 }, 'POINT_10_DECIMAL', 'human')).toEqual(human('bell', 9.5, 3))
    expect(withStep({ ...fine, best: 9.4, worst: 9.3 }, 'POINT_10_DECIMAL', 'human')).toEqual(human('bell', 9.5, 9))
    expect(withStep({ ...fine, best: 0.4, worst: 0.1 }, 'POINT_10_DECIMAL', 'human')).toEqual(human('bell', 1, 0.5))
    expect(withStep(human('bell', 9.5, 3), 'POINT_10_DECIMAL', 'fine')).toEqual({ ...fine, best: 9.5, worst: 3 })
  })

  it('stays human or fine when the Score Format changes', () => {
    expect(convertSettings(human('linear', 8.5, 2.5), 'POINT_10_DECIMAL', 'POINT_100')).toEqual(human('linear', 85, 25))
    expect(convertSettings(human('linear', 95, 30), 'POINT_100', 'POINT_10')).toEqual(human('linear', 9, 3))
    expect(convertSettings(human('linear', 9, 3), 'POINT_10', 'POINT_10_DECIMAL')).toEqual(human('linear', 9, 3))
  })

  it('reads settings saved before the Score Step existed as fine, and rejects best off the Score Step', () => {
    expect(parseSavedScoring({ format: 'POINT_10_DECIMAL', settings: { distribution: 'bell', best: 9.7, worst: 3 } })).toEqual({
      format: 'POINT_10_DECIMAL',
      settings: { distribution: 'bell', step: 'fine', best: 9.7, worst: 3 },
    })
    expect(parseSavedScoring({ format: 'POINT_10_DECIMAL', settings: human('bell', 9.7, 3) })).toBeNull()
    expect(parseSavedScoring({ format: 'POINT_10_DECIMAL', settings: { distribution: 'bell', step: 'coarse', best: 9, worst: 3 } })).toBeNull()
  })
})

describe('Whole Score Step (the Scores Sort Goal, ADR 0007)', () => {
  const whole = (best: number, worst: number) => ({ distribution: 'linear' as const, step: 'whole' as const, best, worst })
  const formats = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const

  it('gives scores every 1 on 10 point decimal and every 10 on 100 point', () => {
    expect(levelsOf(ranking([[[1], [2], [3], [4], [5]]]), 'POINT_10_DECIMAL', whole(10, 3))).toEqual([10, 8, 7, 5, 3])
    expect(levelsOf(ranking([[[1], [2], [3], [4], [5]]]), 'POINT_100', whole(90, 30))).toEqual([90, 80, 60, 50, 30])
  })

  it('lists whole levels on 10 point decimal and 100 point, and the only levels elsewhere', () => {
    expect(levels('POINT_10_DECIMAL', 'whole')).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
    expect(levels('POINT_100', 'whole')).toEqual([100, 90, 80, 70, 60, 50, 40, 30, 20, 10])
    for (const format of ['POINT_10', 'POINT_5', 'POINT_3'] as const) expect(levels(format, 'whole')).toEqual(levels(format))
  })

  it('is labelled 1 and 10', () => {
    expect([stepLabel('POINT_10_DECIMAL', 'whole'), stepLabel('POINT_100', 'whole'), stepLabel('POINT_5', 'whole')]).toEqual(['1', '10', '1'])
  })

  it('moves best and worst to the nearest whole levels, worst still below best', () => {
    const fine = { distribution: 'linear' as const, step: 'fine' as const }
    expect(withStep({ ...fine, best: 9.7, worst: 3.2 }, 'POINT_10_DECIMAL', 'whole')).toEqual(whole(10, 3))
    expect(withStep({ ...fine, best: 9.4, worst: 9.3 }, 'POINT_10_DECIMAL', 'whole')).toEqual(whole(9, 8))
    expect(withStep({ ...fine, best: 0.4, worst: 0.1 }, 'POINT_10_DECIMAL', 'whole')).toEqual(whole(2, 1))
    expect(withStep({ ...fine, best: 94, worst: 34 }, 'POINT_100', 'whole')).toEqual(whole(90, 30))
    expect(withStep({ ...fine, best: 3, worst: 1 }, 'POINT_3', 'whole')).toEqual(whole(3, 1))
  })

  it('has defaults for every Score Format', () => {
    expect(formats.map((format) => defaultSettings(format, 'whole'))).toEqual([
      whole(100, 30), whole(10, 3), whole(10, 3), whole(5, 1), whole(3, 1),
    ])
  })

  it('can be saved and read back, but not off its levels', () => {
    expect(parseSavedScoring({ format: 'POINT_100', settings: whole(90, 30) })).toEqual({ format: 'POINT_100', settings: whole(90, 30) })
    expect(parseSavedScoring({ format: 'POINT_100', settings: whole(95, 30) })).toBeNull()
  })

  it('stays whole when the Score Format changes', () => {
    expect(convertSettings(whole(9, 3), 'POINT_10_DECIMAL', 'POINT_100')).toEqual(whole(90, 30))
    expect(convertSettings(whole(90, 30), 'POINT_100', 'POINT_5')).toEqual(whole(5, 2))
  })
})

describe('Changing the scoring settings', () => {
  it('offers best only above worst and worst only below best', () => {
    const settings = { distribution: 'linear' as const, step: 'fine' as const, best: 5, worst: 2 }
    expect(allowedLevels(settings, 'POINT_5')).toEqual({ best: [5, 4, 3], worst: [4, 3, 2, 1] })
    const human = { distribution: 'bell' as const, step: 'human' as const, best: 8, worst: 6.5 }
    expect(allowedLevels(human, 'POINT_10_DECIMAL').best).toEqual([10, 9.5, 9, 8.5, 8, 7.5, 7])
    expect(allowedLevels(human, 'POINT_10_DECIMAL').worst).toEqual([7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5])
  })

  it('sets best or worst to an allowed level', () => {
    const settings = { distribution: 'bell' as const, step: 'fine' as const, best: 9, worst: 3 }
    expect(changeSettings(settings, 'POINT_10', { best: 7 })).toEqual({ ...settings, best: 7 })
    expect(changeSettings(settings, 'POINT_10', { worst: 8 })).toEqual({ ...settings, worst: 8 })
  })

  it('rejects a worst at or above best, and a best at or below worst, leaving the settings as they were', () => {
    const settings = { distribution: 'linear' as const, step: 'fine' as const, best: 9, worst: 3 }
    expect(changeSettings(settings, 'POINT_10', { worst: 9 })).toBe(settings)
    expect(changeSettings(settings, 'POINT_10', { worst: 10 })).toBe(settings)
    expect(changeSettings(settings, 'POINT_10', { best: 3 })).toBe(settings)
    expect(changeSettings(settings, 'POINT_10', { best: 2 })).toBe(settings)
  })

  it('rejects a level off the Score Step', () => {
    const settings = { distribution: 'linear' as const, step: 'human' as const, best: 9, worst: 3 }
    expect(changeSettings(settings, 'POINT_10_DECIMAL', { best: 9.7 })).toBe(settings)
    expect(changeSettings(settings, 'POINT_10_DECIMAL', { worst: 0 })).toBe(settings)
  })

  it('switches the Distribution and keeps best and worst', () => {
    const settings = { distribution: 'linear' as const, step: 'human' as const, best: 9.5, worst: 3 }
    expect(changeSettings(settings, 'POINT_10_DECIMAL', { distribution: 'bell' })).toEqual({ ...settings, distribution: 'bell' })
  })

  it('moves best and worst to the nearest levels on a new Score Step, worst still below best', () => {
    const fine = { distribution: 'bell' as const, step: 'fine' as const }
    expect(changeSettings({ ...fine, best: 9.7, worst: 3.2 }, 'POINT_10_DECIMAL', { step: 'human' })).toEqual({ ...fine, step: 'human', best: 9.5, worst: 3 })
    expect(changeSettings({ ...fine, best: 9.4, worst: 9.3 }, 'POINT_10_DECIMAL', { step: 'human' })).toEqual({ ...fine, step: 'human', best: 9.5, worst: 9 })
    expect(changeSettings({ ...fine, step: 'human', best: 95, worst: 30 }, 'POINT_100', { step: 'fine' })).toEqual({ ...fine, best: 95, worst: 30 })
  })

  it('on every Score Format and Score Step, offers every level on the step that keeps worst below best, and only those', () => {
    const formats = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const
    for (const format of formats) {
      for (const step of ['fine', 'human', 'whole'] as const) {
        const all = levels(format, step)
        // About 12 best / worst picks per step, from the top level down, with best and worst on neighbouring levels too.
        const stride = Math.max(1, Math.floor(all.length / 12))
        for (let b = 0; b < all.length; b += stride) {
          for (let w = b + 1; w < all.length; w += stride) {
            const settings = { distribution: 'linear' as const, step, best: all[b], worst: all[w] }
            const allowed = allowedLevels(settings, format)
            expect(allowed.best).toEqual(all.slice(0, w))
            expect(allowed.worst).toEqual(all.slice(b + 1))
            for (const level of all) {
              expect(changeSettings(settings, format, { best: level }).best).toBe(level > settings.worst ? level : settings.best)
              expect(changeSettings(settings, format, { worst: level }).worst).toBe(level < settings.best ? level : settings.worst)
            }
          }
        }
      }
    }
  })
})

/** Custom settings with these five points, best first. */
const custom = (best: number, p25: number, p50: number, p75: number, worst: number, step: ScoreStep = 'fine'): ScoringSettings => ({
  distribution: 'custom',
  step,
  best,
  worst,
  quartiles: { p25, p50, p75 },
})

describe('Custom (ADR 0014)', () => {
  const line = (n: number) => ranking([Array.from({ length: n }, (_, i) => [i + 1])])

  it('puts best, the Quartile scores and worst at 0 / 25 / 50 / 75 / 100% of the Ranking', () => {
    expect(levelsOf(line(5), 'POINT_10', custom(10, 9, 8, 6, 2))).toEqual([10, 9, 8, 6, 2])
  })

  it('is a straight line between neighbouring points', () => {
    expect(levelsOf(line(9), 'POINT_10_DECIMAL', custom(10, 9, 8, 6, 2))).toEqual([10, 9.5, 9, 8.5, 8, 7, 6, 4, 2])
  })

  it('gives a flat stretch on one level between equal neighbours', () => {
    expect(levelsOf(line(9), 'POINT_10_DECIMAL', custom(10, 8, 8, 6, 2))).toEqual([10, 9, 8, 8, 8, 7, 6, 4, 2])
  })

  it('uses a Tier average position, and gives one title alone best', () => {
    // Positions 0, (1, 2), 3, 4 among 5: the Tier sits at 1.5 / 4 = 37.5%, halfway between 9 and 8.
    expect(levelsOf(ranking([[[1], [2, 3], [4], [5]]]), 'POINT_10_DECIMAL', custom(10, 9, 8, 6, 2))).toEqual([10, 8.5, 8.5, 6, 2])
    expect(levelsOf(line(1), 'POINT_10', custom(9, 7, 5, 3, 1))).toEqual([9])
  })

  it('rounds to the Score Step', () => {
    // 9 titles on the human step: 7.25 at 12.5% → 7.5, 6.25 at 37.5% → 6.5, 5 at 62.5%, 3 at 87.5%.
    expect(levelsOf(line(9), 'POINT_10_DECIMAL', custom(8, 6.5, 6, 4, 2, 'human'))).toEqual([8, 7.5, 6.5, 6.5, 6, 5, 4, 3, 2])
  })

  it('on every Score Format and Score Step, never rises down the Ranking and stays on the step', () => {
    let seed = 83
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    // Building a Ranking through the engine is the slow part: a few sizes, shared by every trial.
    const rankings = [1, 2, 3, 4, 5, 7, 10, 17, 41].map(line)
    for (const format of ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const) {
      for (const step of ['fine', 'human', 'whole'] as const) {
        const all = levels(format, step)
        for (let trial = 0; trial < 40; trial++) {
          // Five picks from the step's levels, best first; any two neighbours may be equal, best and worst never are.
          const picks = Array.from({ length: 5 }, () => all[Math.floor(random() * all.length)]).sort((x, y) => y - x)
          if (picks[0] === picks[4]) continue
          const [best, p25, p50, p75, worst] = picks
          const settings = { distribution: 'custom' as const, step, best, worst, quartiles: { p25, p50, p75 } }
          const ranked = rankings[Math.floor(random() * rankings.length)]
          const n = ranked.bands[0].tiers.length
          const got = levelsOf(ranked, format, settings)
          expect(got[0]).toBe(best)
          if (n > 1) expect(got.at(-1)).toBe(worst)
          for (let i = 1; i < n; i++) expect(got[i]).toBeLessThanOrEqual(got[i - 1])
          for (const level of got) expect(all).toContain(level)
        }
      }
    }
  })

  it('leaves Linear and Bell as they are, even with Quartile scores in the settings', () => {
    const quartiles = { p25: 3, p50: 3, p75: 3 }
    expect(levelsOf(line(5), 'POINT_10', { distribution: 'linear', step: 'fine', best: 10, worst: 2, quartiles })).toEqual([10, 8, 6, 4, 2])
    expect(levelsOf(line(4), 'POINT_10', { distribution: 'bell', step: 'fine', best: 10, worst: 2, quartiles })).toEqual([8, 7, 5, 4])
  })
})

describe('Changing the Custom settings (ADR 0014)', () => {
  it('starts the Quartile scores where Linear puts them, the first time Custom is picked', () => {
    const linear = { distribution: 'linear' as const, step: 'fine' as const, best: 10, worst: 2 }
    expect(changeSettings(linear, 'POINT_10', { distribution: 'custom' })).toEqual(custom(10, 8, 6, 4, 2))
    // 8.25 → 8.5, 6.5, 4.75 → 5 on the human step.
    const human = { distribution: 'linear' as const, step: 'human' as const, best: 10, worst: 3 }
    expect(changeSettings(human, 'POINT_10_DECIMAL', { distribution: 'custom' })).toEqual(custom(10, 8.5, 6.5, 5, 3, 'human'))
  })

  it('starts the Quartile scores where Bell puts them', () => {
    // mid 50, σ 20: 50 ± 0.6745 × 20 = 63.49, 36.51.
    const bell = { distribution: 'bell' as const, step: 'fine' as const, best: 90, worst: 10 }
    expect(changeSettings(bell, 'POINT_100', { distribution: 'custom' })).toEqual(custom(90, 63, 50, 37, 10))
  })

  it('keeps the Quartile scores when switching to Linear or Bell, and brings them back with Custom', () => {
    const mine = custom(10, 9, 9, 5, 2)
    const bell = changeSettings(mine, 'POINT_10', { distribution: 'bell' })
    expect(bell).toEqual({ ...mine, distribution: 'bell' })
    const linear = changeSettings(bell, 'POINT_10', { distribution: 'linear' })
    expect(changeSettings(linear, 'POINT_10', { distribution: 'custom' })).toEqual(mine)
  })

  it('offers each Quartile score only between its neighbours, equal allowed', () => {
    const allowed = allowedLevels(custom(10, 8, 6, 4, 2), 'POINT_10')
    expect(allowed).toEqual({
      best: [10, 9, 8, 7, 6, 5, 4, 3],
      p25: [10, 9, 8, 7, 6],
      p50: [8, 7, 6, 5, 4],
      p75: [6, 5, 4, 3, 2],
      worst: [9, 8, 7, 6, 5, 4, 3, 2, 1],
    })
  })

  it('sets a Quartile score to an allowed level and rejects any other, leaving the settings as they were', () => {
    const settings = custom(10, 8, 6, 4, 2)
    expect(changeSettings(settings, 'POINT_10', { p25: 10 })).toEqual(custom(10, 10, 6, 4, 2))
    expect(changeSettings(settings, 'POINT_10', { p50: 4 })).toEqual(custom(10, 8, 4, 4, 2))
    expect(changeSettings(settings, 'POINT_10', { p75: 2 })).toEqual(custom(10, 8, 6, 2, 2))
    expect(changeSettings(settings, 'POINT_10', { p25: 5 })).toBe(settings)
    expect(changeSettings(settings, 'POINT_10', { p50: 9 })).toBe(settings)
    expect(changeSettings(settings, 'POINT_10', { p75: 1 })).toBe(settings)
    const human = { ...settings, step: 'human' as const }
    expect(changeSettings(human, 'POINT_10_DECIMAL', { p50: 6.2 })).toBe(human)
  })

  it('offers no Quartile scores before Custom was first picked', () => {
    const linear = { distribution: 'linear' as const, step: 'fine' as const, best: 10, worst: 2 }
    expect(allowedLevels(linear, 'POINT_10')).toEqual({ best: [10, 9, 8, 7, 6, 5, 4, 3], worst: [9, 8, 7, 6, 5, 4, 3, 2, 1] })
    expect(changeSettings(linear, 'POINT_10', { p50: 6 })).toBe(linear)
  })

  it('moves Quartile scores just enough when best is lowered or worst raised past them, and leaves the others', () => {
    const settings = custom(10, 8, 6, 4, 2)
    expect(changeSettings(settings, 'POINT_10', { best: 7 })).toEqual(custom(7, 7, 6, 4, 2))
    expect(changeSettings(settings, 'POINT_10', { best: 5 })).toEqual(custom(5, 5, 5, 4, 2))
    expect(changeSettings(settings, 'POINT_10', { worst: 7 })).toEqual(custom(10, 8, 7, 7, 7))
    expect(changeSettings(settings, 'POINT_10', { best: 9 })).toEqual(custom(9, 8, 6, 4, 2))
  })

  it('moves the Quartile scores to the nearest levels on a new Score Step', () => {
    expect(changeSettings(custom(9.7, 8.3, 6.2, 4.4, 3.2), 'POINT_10_DECIMAL', { step: 'human' })).toEqual(custom(9.5, 8.5, 6, 4.5, 3, 'human'))
    expect(changeSettings(custom(9.5, 8.5, 6, 4.5, 3, 'human'), 'POINT_10_DECIMAL', { step: 'fine' })).toEqual(custom(9.5, 8.5, 6, 4.5, 3))
    // Best 0.4 and worst 0.1 become 1 and 0.5; the Quartile scores stay between them.
    expect(changeSettings(custom(0.4, 0.4, 0.3, 0.1, 0.1), 'POINT_10_DECIMAL', { step: 'human' })).toEqual(custom(1, 0.5, 0.5, 0.5, 0.5, 'human'))
  })

  it('carries the Quartile scores to a new Score Format through their raw scores, then keeps the order (ADR 0003)', () => {
    expect(convertSettings(custom(9.5, 8.5, 7, 5.5, 2), 'POINT_10_DECIMAL', 'POINT_10')).toEqual(custom(9, 8, 7, 5, 2))
    expect(convertSettings(custom(9.5, 8.5, 7, 5.5, 2), 'POINT_10_DECIMAL', 'POINT_3')).toEqual(custom(3, 3, 3, 2, 1))
    // 8 and 5 are below 10 point's lowest level: never 0, and never below worst.
    expect(convertSettings(custom(50, 30, 8, 5, 3), 'POINT_100', 'POINT_10')).toEqual(custom(5, 3, 1, 1, 1))
    // Kept while on Linear too.
    expect(convertSettings({ ...custom(9.5, 8.5, 7, 5.5, 2), distribution: 'linear' }, 'POINT_10_DECIMAL', 'POINT_10')).toEqual({
      ...custom(9, 8, 7, 5, 2),
      distribution: 'linear',
    })
  })

  it('reads saved Custom settings back, and keeps Quartile scores saved under Linear or Bell', () => {
    const saved = { format: 'POINT_10_DECIMAL' as const, settings: custom(10, 8.5, 8.5, 6, 4, 'human') }
    expect(parseSavedScoring(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    const bell = { ...saved, settings: { ...saved.settings, distribution: 'bell' as const } }
    expect(parseSavedScoring(JSON.parse(JSON.stringify(bell)))).toEqual(bell)
    const old = { format: 'POINT_10' as const, settings: { distribution: 'linear' as const, step: 'fine' as const, best: 9, worst: 2 } }
    expect(parseSavedScoring(old)).toStrictEqual(old)
  })

  it('rejects saved Quartile scores off the Score Step, out of order, or missing under Custom', () => {
    const read = (settings: unknown) => parseSavedScoring({ format: 'POINT_10_DECIMAL', settings })
    expect(read(custom(10, 8.2, 7, 6, 4, 'human'))).toBeNull()
    expect(read(custom(10, 8, 8.5, 6, 4))).toBeNull()
    expect(read(custom(9, 9.5, 8, 6, 4))).toBeNull()
    expect(read(custom(10, 8, 7, 3, 4))).toBeNull()
    expect(read({ ...custom(10, 8, 7, 6, 4), quartiles: { p25: 8, p50: 7 } })).toBeNull()
    expect(read({ ...custom(10, 8, 7, 6, 4), quartiles: 'high' })).toBeNull()
    expect(read({ ...custom(10, 8, 7, 3, 4), distribution: 'linear' })).toBeNull()
    expect(read({ distribution: 'custom', step: 'fine', best: 10, worst: 4 })).toBeNull()
  })

  it('on every Score Format and Score Step, any change keeps best ≥ 25% ≥ 50% ≥ 75% ≥ worst on the step', () => {
    let seed = 81
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const formats = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const
    const points = ['best', 'p25', 'p50', 'p75', 'worst'] as const
    for (const format of formats) {
      for (const step of ['fine', 'human', 'whole'] as const) {
        const all = levels(format, step)
        for (let trial = 0; trial < 12; trial++) {
          const picks = Array.from({ length: 5 }, () => all[Math.floor(random() * all.length)]).sort((x, y) => y - x)
          if (picks[0] === picks[4]) continue
          const settings = custom(picks[0], picks[1], picks[2], picks[3], picks[4], step)
          const allowed = allowedLevels(settings, format)
          // Every level on short scales; on 100-level ones every fifth, and the levels at and next to each point.
          const near = picks.flatMap((p) => [-1, 0, 1].map((d) => all[all.indexOf(p) + d])).filter((l) => l !== undefined)
          const tried = all.length <= 25 ? all : [...new Set([...all.filter((_, i) => i % 5 === 0), ...near])]
          for (const point of points) {
            for (const level of tried) {
              const next = changeSettings(settings, format, { [point]: level } as SettingsChange)
              const chain = [next.best, next.quartiles!.p25, next.quartiles!.p50, next.quartiles!.p75, next.worst]
              if (allowed[point]!.includes(level)) expect(chain[points.indexOf(point)]).toBe(level)
              else expect(next).toBe(settings)
              for (let i = 1; i < 5; i++) expect(chain[i]).toBeLessThanOrEqual(chain[i - 1])
              expect(next.worst).toBeLessThan(next.best)
              for (const l of chain) expect(all).toContain(l)
            }
          }
          for (const other of formats) {
            const moved = convertSettings(settings, format, other)
            const chain = [moved.best, moved.quartiles!.p25, moved.quartiles!.p50, moved.quartiles!.p75, moved.worst]
            for (let i = 1; i < 5; i++) expect(chain[i]).toBeLessThanOrEqual(chain[i - 1])
            for (const l of chain) expect(levels(other, step)).toContain(l)
          }
        }
      }
    }
  })
})

describe('Titles moved by a settings change (the first pick of Custom, #85)', () => {
  const line = (n: number) => ranking([Array.from({ length: n }, (_, i) => [i + 1])])

  it('counts the titles whose level changed', () => {
    // Linear 10 → 3 on the human step: 10, 9, 8.5, 7.5, 6.5, 5.5, 5, 4, 3. Custom from it (10, 8.5, 6.5, 5, 3):
    // 10, 9.5, 8.5, 7.5, 6.5, 6, 5, 4, 3, so the 2nd and 6th titles moved.
    const linear = { distribution: 'linear' as const, step: 'human' as const, best: 10, worst: 3 }
    const picked = changeSettings(linear, 'POINT_10_DECIMAL', { distribution: 'custom' })
    expect(movedTitles(line(9), 'POINT_10_DECIMAL', linear, picked)).toBe(2)
  })

  it('counts nothing when every title keeps its level', () => {
    // Linear 10 → 2 over 5 titles is 10, 8, 6, 4, 2, which is where Custom's points start.
    const linear = { distribution: 'linear' as const, step: 'fine' as const, best: 10, worst: 2 }
    const picked = changeSettings(linear, 'POINT_10', { distribution: 'custom' })
    expect(movedTitles(line(5), 'POINT_10', linear, picked)).toBe(0)
  })

  it('on Scores, does not count a title the change leaves unsettled', () => {
    // Positions among 5: titles 2 and 3 go 8 → 9 and 6 → 8; title 4, between 2.4 and 2.6, is 5 under Linear
    // (5.2, 4.8) but 7 or 6 under Custom (6.8, 6.2).
    const at = (min: number, max: number) => ({ band: 0 as const, min, max })
    const state: RankingState = {
      ...line(5),
      // `score` reads only the positions; `settled` is the engine's, under the log's settings.
      standing: { size: 5, settled: new Set(), titles: new Map([[1, at(0, 0)], [2, at(1, 1)], [3, at(2, 2)], [4, at(2.4, 2.6)], [5, at(4, 4)]]) },
    }
    const linear = { distribution: 'linear' as const, step: 'fine' as const, best: 10, worst: 2 }
    expect(movedTitles(state, 'POINT_10', linear, custom(10, 9, 8, 5, 2))).toBe(2)
  })
})

describe('The first pick of Custom (#85)', () => {
  const linear = { distribution: 'linear' as const, step: 'fine' as const, best: 10, worst: 2 }
  const bell = { ...linear, distribution: 'bell' as const }

  it('is a switch to Custom from Linear or Bell before any Quartile scores exist', () => {
    expect(isFirstCustomPick(linear, { distribution: 'custom' })).toBe(true)
    expect(isFirstCustomPick(bell, { distribution: 'custom' })).toBe(true)
  })

  it('is not a switch back to Custom once its Quartile scores exist', () => {
    const away = { ...custom(10, 8, 6, 4, 2), distribution: 'bell' as const }
    expect(isFirstCustomPick(away, { distribution: 'custom' })).toBe(false)
  })

  it('is not any other change', () => {
    expect(isFirstCustomPick(linear, { distribution: 'bell' })).toBe(false)
    expect(isFirstCustomPick(linear, { step: 'human' })).toBe(false)
    expect(isFirstCustomPick(linear, { best: 9 })).toBe(false)
    expect(isFirstCustomPick(custom(10, 8, 6, 4, 2), { distribution: 'custom' })).toBe(false)
  })
})
