// The AniDuel! login as Top Studios sees it (#91). The page reads the token AniDuel! stored (same origin) and never
// starts a login of its own; the user's own name comes from the Viewer query.
import { AniListError, createAniListGateway } from '../anilist/gateway.ts'
import type { TopStudiosSession } from './loadTopStudios.ts'
import type { OwnName } from './ui/studiosView.ts'

/** The login once checked: the user's own name if known, and the token to send with lookups (null once refused). */
export type CheckedLogin = { own: OwnName; token: string | null }

export async function checkLogin(session: TopStudiosSession): Promise<CheckedLogin> {
  const { fetch, token } = session
  if (!token) return { own: { kind: 'none' }, token: null }
  try {
    const viewer = await createAniListGateway({ fetch, token }).viewer()
    return { own: { kind: 'known', name: viewer.name }, token }
  } catch (error) {
    // An expired or revoked login: the page carries on without it. Anything else may pass; the token stays for lookups.
    const refused = error instanceof AniListError && error.kind === 'auth'
    return { own: { kind: 'none' }, token: refused ? null : token }
  }
}
