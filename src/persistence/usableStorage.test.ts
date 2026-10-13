// The storage check (#76): a browser that blocks site storage is told apart before the app renders.
import { describe, expect, it } from 'vitest'
import { memoryStorage } from './memoryStorage.ts'
import { usableStorage } from './usableStorage.ts'

function blocked(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

function full(): never {
  throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
}

/** A storage holding `saved`, with `overrides` in place of its own methods. */
function storageWith(overrides: Partial<Storage>, saved: Record<string, string> = {}): Storage {
  const storage = memoryStorage()
  for (const [key, value] of Object.entries(saved)) storage.setItem(key, value)
  return Object.defineProperties(storage, Object.getOwnPropertyDescriptors(overrides))
}

describe('the storage check', () => {
  it('answers the storage itself when it works, and leaves nothing behind in it', () => {
    const storage = storageWith({}, { 'aniduel/theme': 'dark' })
    expect(usableStorage(() => storage)).toBe(storage)
    expect(storage.length).toBe(1)
    expect(storage.getItem('aniduel/theme')).toBe('dark')
  })

  it('answers null when reaching the storage throws', () => {
    expect(usableStorage(blocked)).toBeNull()
  })

  it('answers null when writing a key throws', () => {
    expect(usableStorage(() => storageWith({ setItem: blocked }, { 'aniduel/theme': 'dark' }))).toBeNull()
  })

  it('answers null when reading a key throws', () => {
    expect(usableStorage(() => storageWith({ getItem: blocked }))).toBeNull()
  })

  it('answers null when removing a key throws', () => {
    expect(usableStorage(() => storageWith({ removeItem: blocked }))).toBeNull()
  })

  it('answers null when there is no storage at all', () => {
    expect(usableStorage(() => undefined as unknown as Storage)).toBeNull()
  })

  it('answers a full storage that holds something: what it holds can still be read', () => {
    const storage = storageWith({ setItem: full }, { 'aniduel/token': 'abc' })
    expect(usableStorage(() => storage)).toBe(storage)
  })

  it('answers null for an empty storage with no room: it would never keep anything', () => {
    expect(usableStorage(() => storageWith({ setItem: full }))).toBeNull()
  })
})
