// Persistence: localStorage keys for a user's saved progress, keyed by AniList user id and Media Type.
// Every key belonging to one user starts with `aniduel/progress/<userId>/`, so logout can delete them all.
import type { MediaType } from '../anilist/types.ts'

export type ProgressKey = { userId: number; mediaType: MediaType; part: string }

const PREFIX = 'aniduel/progress/'

function userPrefix(userId: number): string {
  return `${PREFIX}${userId}/`
}

export function progressStorageKey({ userId, mediaType, part }: ProgressKey): string {
  return `${userPrefix(userId)}${mediaType}/${part}`
}

export function saveProgressPart(storage: Storage, key: ProgressKey, value: string): void {
  storage.setItem(progressStorageKey(key), value)
}

export function loadProgressPart(storage: Storage, key: ProgressKey): string | null {
  return storage.getItem(progressStorageKey(key))
}

/** Deletes everything saved for one user in this browser (every Media Type). */
export function deleteSavedProgress(storage: Storage, userId: number): void {
  const prefix = userPrefix(userId)
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}
