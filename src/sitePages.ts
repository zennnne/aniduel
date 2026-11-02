/**
 * The site's two pages (ADR 0015): AniDuel! at /aniduel/ and Top Studios at /aniduel/studios/, linked both ways.
 * Under `npm run dev`, a link from a page opened with `?fake-anilist` keeps the switch, so the fake AniList carries
 * over; the production build drops that branch with the string in it (vite.config.test.ts).
 */
export function sitePage(page: 'aniduel' | 'studios'): string {
  const fake = import.meta.env.DEV && new URLSearchParams(window.location.search).has('fake-anilist')
  return `${import.meta.env.BASE_URL}${page === 'studios' ? 'studios/' : ''}${fake ? '?fake-anilist' : ''}`
}
