// The remembered split choice (ADR 0013): the Picker's "Ask me" / "More Duels first", kept per user in injected Storage.
import { describe, expect, it } from 'vitest'
import { startKeepMyScaleLog } from '../ranking/engine.ts'
import { createBackup, readBackup, restoreBackup } from './backup.ts'
import { memoryStorage } from './memoryStorage.ts'
import { deleteSavedProgress, saveDuelLog } from './progress.ts'
import { createSplitChoiceStore } from './splitChoice.ts'

describe('the remembered split choice', () => {
  it('is nothing until the user has made one', () => {
    expect(createSplitChoiceStore(memoryStorage(), 7).choice()).toBeNull()
  })

  it('is the choice last remembered, either way', () => {
    const storage = memoryStorage()
    createSplitChoiceStore(storage, 7).remember('deciding-duels')
    expect(createSplitChoiceStore(storage, 7).choice()).toBe('deciding-duels')

    createSplitChoiceStore(storage, 7).remember('on-the-score')
    expect(createSplitChoiceStore(storage, 7).choice()).toBe('on-the-score')
  })

  it('is never shared by two users in one browser', () => {
    const storage = memoryStorage()
    createSplitChoiceStore(storage, 7).remember('deciding-duels')
    expect(createSplitChoiceStore(storage, 8).choice()).toBeNull()

    createSplitChoiceStore(storage, 8).remember('on-the-score')
    expect(createSplitChoiceStore(storage, 7).choice()).toBe('deciding-duels')
  })

  it('is nothing when what is stored is not one of the two choices', () => {
    const storage = memoryStorage()
    createSplitChoiceStore(storage, 7).remember('deciding-duels')
    for (let i = 0; i < storage.length; i++) storage.setItem(storage.key(i)!, 'always-ask')
    expect(createSplitChoiceStore(storage, 7).choice()).toBeNull()
  })

  it("goes with the user's saved progress when they log out and delete it", () => {
    const storage = memoryStorage()
    createSplitChoiceStore(storage, 7).remember('deciding-duels')
    createSplitChoiceStore(storage, 8).remember('deciding-duels')
    deleteSavedProgress(storage, 7)
    expect(createSplitChoiceStore(storage, 7).choice()).toBeNull()
    expect(createSplitChoiceStore(storage, 8).choice()).toBe('deciding-duels')
  })

  it('is not part of a Backup: a Restore neither brings one nor changes the one here', () => {
    const anime = { userId: 7, mediaType: 'ANIME' as const }
    const anchors = [9, 9, 8, 8, 7, 7].map((level, i) => ({ id: 101 + i, level }))
    const here = memoryStorage()
    saveDuelLog(here, startKeepMyScaleLog({ ...anime, seed: 42, format: 'POINT_10', anchors, ids: [1], split: 'deciding-duels' }))
    createSplitChoiceStore(here, 7).remember('deciding-duels')
    const file = createBackup(here, { ...anime, userName: 'zen' }, new Date('2026-10-13T12:00:00Z'))!

    const elsewhere = memoryStorage()
    restoreBackup(elsewhere, readBackup(file.json, anime))
    expect(createSplitChoiceStore(elsewhere, 7).choice()).toBeNull()

    const other = memoryStorage()
    createSplitChoiceStore(other, 7).remember('on-the-score')
    restoreBackup(other, readBackup(file.json, anime))
    expect(createSplitChoiceStore(other, 7).choice()).toBe('on-the-score')
  })
})
