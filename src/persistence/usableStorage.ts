// The storage check (#76): the app keeps the login and all progress in the browser's storage, so it is tried once
// before anything renders. A browser that blocks site storage fails in one of two ways: reaching the storage object
// throws, or reading / writing a key does.
const PROBE_KEY = 'aniduel/storage-check'

/** A write refused for lack of room, which is not a blocked storage. */
function isFull(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
}

/** The storage `open` reaches, or null when it can't be used. `open` is called inside the check, as reaching it may throw. */
export function usableStorage(open: () => Storage): Storage | null {
  try {
    const storage = open()
    storage.getItem(PROBE_KEY)
    try {
      storage.setItem(PROBE_KEY, PROBE_KEY)
      storage.removeItem(PROBE_KEY)
    } catch (error) {
      // A full storage that holds something still has the login and the progress to read, back up or delete; the app
      // says so itself when a save fails. An empty one with no room never keeps anything.
      if (!isFull(error) || storage.length === 0) return null
    }
    return storage
  } catch {
    return null
  }
}
