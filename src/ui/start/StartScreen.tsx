import type { ListEntry, ListStatus, MediaType, Viewer } from '../../anilist/types.ts'
import { OFFERED_STATUSES, displayTitle, estimateMinutes, type Pool } from '../../pool/pool.ts'
import './start.css'
import { statusLabel } from './statusLabel.ts'


const PLACEHOLDER_COLOURS = ['#3db4f2', '#c063ff', '#ffb3c8', '#bfe8c9', '#ffe08a', '#c9d4ff']

export type PoolForm = {
  viewer: Viewer
  mediaType: MediaType
  statuses: readonly ListStatus[]
  /** null while the list is loading. */
  pool: Pool | null
  onMediaType: (type: MediaType) => void
  onToggleStatus: (status: ListStatus) => void
  onLogout: () => void
  /** Starts a new Ranking, or continues the saved one. Undefined while it can't (e.g. saved progress is unreadable). */
  onStartRoughSort?: () => void
  /** Rough Sort progress of the Ranking saved for this Media Type, if there is one. */
  saved?: { done: number; total: number } | null
  /** Opens Restore from Backup (e.g. on a new browser). */
  onRestore?: () => void
}

/** Start = "Hero split" (issue #4): a cover collage on the left, one card on the right that holds login, then the Pool form. */
export function StartScreen(props: {
  form: PoolForm | null
  covers: readonly ListEntry[]
  loggingIn: boolean
  onLogin: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}) {
  const { form, covers, loggingIn, onLogin, theme, onToggleTheme } = props
  return (
    <div className="st st-hero">
      <button className="theme-toggle" onClick={onToggleTheme} title="Light/dark theme">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
      <div className="l">
        <Collage covers={covers} viewer={form?.viewer ?? null} />
        <div className="hero-copy">
          <span className="kao" style={{ background: 'var(--band-loved)', fontSize: 20, alignSelf: 'flex-start' }}>
            (♡˙︶˙♡)
          </span>
          <div className="big">
            Which one did you
            <br />
            like more?
          </div>
          <div>
            Answer that a few hundred times.
            <br />
            Get scores that actually mean something.
          </div>
        </div>
      </div>
      <div className="r">
        <div className="panel">
          {form ? (
            <PoolSetup {...form} />
          ) : (
            <>
              <div className="h1">AniDuel!</div>
              <p>Score your AniList by picking the better of two, again and again.</p>
              <button className="go" onClick={onLogin} disabled={loggingIn}>
                <span className="almark">A</span> {loggingIn ? 'Loading…' : 'Log in with AniList'}
              </button>
              <Reassure />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Reassure() {
  return (
    <div className="small fine">Read-only until you confirm an Import. Your progress stays in this browser.</div>
  )
}

function Collage({ covers, viewer }: { covers: readonly ListEntry[]; viewer: Viewer | null }) {
  const tiles = covers.filter((c) => c.coverUrl).slice(0, 36)
  return (
    <div className="collage-bg" aria-hidden="true">
      {tiles.length > 0
        ? tiles.map((c) => {
            const name = viewer ? displayTitle(c.title, viewer.titleLanguage) : c.title.romaji
            return (
              <img
                key={c.mediaId}
                className="cv"
                src={c.coverUrl ?? undefined}
                alt={name}
                title={name}
                style={{ background: c.coverColor ?? 'var(--blue)' }}
                draggable={false}
              />
            )
          })
        : Array.from({ length: 36 }, (_, i) => (
            <div
              key={i}
              className="cv ph"
              style={{ background: `linear-gradient(160deg, ${PLACEHOLDER_COLOURS[i % PLACEHOLDER_COLOURS.length]}, var(--nav))` }}
            />
          ))}
    </div>
  )
}

function PoolSetup(form: PoolForm) {
  const { viewer, mediaType, statuses, pool } = form
  const chosen = new Set(statuses)
  const label = (s: (typeof OFFERED_STATUSES)[number]) => statusLabel(s, mediaType)
  const n = pool?.titles.length ?? 0

  return (
    <>
      <div className="userbar">
        {viewer.avatarUrl ? <img className="ava" src={viewer.avatarUrl} alt="" /> : <span className="ava" />}
        <span>{viewer.name}</span>
        <button className="small link" onClick={form.onLogout}>
          Log out
        </button>
      </div>
      <div className="h2">What do you want to rank?</div>
      <div className="seg" role="radiogroup" aria-label="Media Type">
        {(['ANIME', 'MANGA'] as const).map((type) => (
          <button
            key={type}
            role="radio"
            aria-checked={mediaType === type}
            className={mediaType === type ? 'on' : ''}
            onClick={() => form.onMediaType(type)}
          >
            {type === 'ANIME' ? 'Anime' : 'Manga'}
          </button>
        ))}
      </div>
      <div className="lab2">List statuses</div>
      <div className="chips">
        {OFFERED_STATUSES.map((s) => (
          <button
            key={s}
            className={chosen.has(s) ? 'chip on' : 'chip'}
            aria-pressed={chosen.has(s)}
            onClick={() => form.onToggleStatus(s)}
          >
            {chosen.has(s) ? '✓ ' : ''}
            {label(s)} <span className="cnt">{pool ? pool.countByStatus[s] : '…'}</span>
          </button>
        ))}
        <span className="chip off" title={`You haven't ${mediaType === 'MANGA' ? 'read' : 'watched'} these yet`}>
          Planning · never ranked
        </span>
      </div>
      <div className="est" aria-live="polite">
        {pool ? (
          <>
            <b>{n}</b> titles · about <b>{pool.expectedDuels}</b> Duels
            <span className="small">
              (~{estimateMinutes(pool.expectedDuels)} min at 3 s each, spread over as many sittings as you like)
            </span>
          </>
        ) : (
          'Loading your list…'
        )}
      </div>
      {form.saved && (
        <div className="small">
          You have a saved Ranking here: {form.saved.done} of {form.saved.total} titles have a Band. On Continue,
          titles that now match these statuses join Rough Sort and titles that no longer match leave the Ranking.
        </div>
      )}
      <button
        className="go"
        disabled={!form.onStartRoughSort || (!form.saved && (!pool || n === 0))}
        onClick={form.onStartRoughSort}
      >
        {form.saved ? 'Continue →' : 'Start Rough Sort →'}
      </button>
      {form.onRestore && (
        <button className="small link" style={{ alignSelf: 'flex-start' }} onClick={form.onRestore}>
          Restore from a Backup file
        </button>
      )}
      <Reassure />
    </>
  )
}
