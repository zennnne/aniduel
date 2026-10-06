import { describe, expect, it } from 'vitest'
import type { RankingState } from './engine.ts'
import { convertSettings, defaultSettings, formatLevel, hasHumanStep, levelOfRaw, levels, parseSavedScoring, score, settingsFor, stepLabel, withStep } from './scoring.ts'
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
