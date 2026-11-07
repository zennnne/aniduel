/**
 * The site's pages (ADR 0015, ADR 0016): AniDuel! at /aniduel/, the AniLyze hub at /aniduel/anilyze/ and its tools
 * under it. Under `npm run dev`, a link from a page opened with `?fake-anilist` keeps the switch, so the fake AniList
 * carries over; the production build drops that branch with the string in it (vite.config.test.ts).
 */
export type SitePage = 'aniduel' | 'anilyze' | Tool

/** AniLyze's tools, each a page under /aniduel/anilyze/. */
export type Tool = 'studios' | 'directors'

const PATHS: Record<SitePage, string> = {
  aniduel: '',
  anilyze: 'anilyze/',
  studios: 'anilyze/studios/',
  directors: 'anilyze/directors/',
}

export function sitePage(page: SitePage): string {
  return linkTo(page, [])
}

/** A tool opened for `userName` with `?user=`, so the result loads at once; blank (no `user`) when the name is empty. */
export function toolLink(tool: Tool, userName: string): string {
  const name = userName.trim()
  return linkTo(tool, name ? [`user=${encodeURIComponent(name)}`] : [])
}

function linkTo(page: SitePage, params: string[]): string {
  const fake = import.meta.env.DEV && new URLSearchParams(window.location.search).has('fake-anilist')
  const query = [...(fake ? ['fake-anilist'] : []), ...params]
  return `${import.meta.env.BASE_URL}${PATHS[page]}${query.length ? `?${query.join('&')}` : ''}`
}

/**
 * Where a link to Top Studios' old path, /aniduel/studios/ (ADR 0015), goes now: its new page, with the query and
 * hash kept exactly as they were (`?user=`, and under `npm run dev` `?fake-anilist`).
 */
export function movedStudiosUrl({ search, hash }: { search: string; hash: string }): string {
  return `${import.meta.env.BASE_URL}${PATHS.studios}${search}${hash}`
}
