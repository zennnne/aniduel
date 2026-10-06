// The menu's Board entry (#34): only while the Board is open, i.e. before the first Duel answer.
import { describe, expect, it } from 'vitest'
import { replay, startLog, type BandIndex, type DuelLog, type LogEvent } from '../../ranking/engine.ts'
import { buildMenuItems, type MenuActions } from './buildMenuItems.ts'

const header = { seed: 42, userId: 7, mediaType: 'ANIME' as const }

function logOf(ids: number[], ...events: LogEvent[]): DuelLog {
  const log = startLog({ ...header, ids })
  return { ...log, events: [...log.events, ...events] }
}

const assign = (id: number, band: BandIndex): LogEvent => ({ type: 'band-assigned', id, band })
const duel: LogEvent = { type: 'duel-answered', a: 2, b: 1, result: 'a' }

const noop = () => {}
const actions: MenuActions = {
  switchMediaType: noop,
  changeStatuses: noop,
  saveBackup: noop,
  chooseBand: noop,
  splitBand: noop,
  openBoard: noop,
  restore: noop,
  startOver: noop,
  toggleTheme: noop,
  logout: noop,
}

const ids = (log: DuelLog) =>
  buildMenuItems(
    { mediaType: 'ANIME', statuses: ['COMPLETED'], hasLog: true, hasProgress: true, ranking: replay(log), choosingBand: false, splitOffers: [] },
    actions,
  ).map((item) => item.id)

describe('the Board in the menu', () => {
  it('is offered during Rough Sort and after it, before any Duel answer', () => {
    expect(ids(logOf([1, 2], assign(1, 0)))).toContain('board')
    expect(ids(logOf([1, 2], assign(1, 0), assign(2, 0)))).toContain('board')
  })

  it('is hidden once a Duel is answered, and back when Undo removes it', () => {
    const answered = logOf([1, 2], assign(1, 0), assign(2, 0), duel)
    expect(ids(answered)).not.toContain('board')
    expect(ids({ ...answered, events: [...answered.events, { type: 'undo' }] })).toContain('board')
  })
})
