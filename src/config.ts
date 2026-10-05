// AniList API clients registered for AniDuel! (spike #3). Each one's redirect URL must match exactly.
const PRODUCTION_CLIENT_ID = 52824 // https://zennnne.github.io/aniduel/
const DEV_CLIENT_ID = 52827 // http://localhost:5173/aniduel/

export function aniListClientId({ dev }: { dev: boolean }): number {
  return dev ? DEV_CLIENT_ID : PRODUCTION_CLIENT_ID
}
