import { useState } from 'react'
import type { Cover, ListStatus, MediaType, Viewer } from '../../anilist/types.ts'
import { OFFERED_STATUSES, displayTitle, estimateMinutes, type Pool } from '../../pool/pool.ts'
import { BANDS } from '../../ranking/engine.ts'
import type { ScoresPlan } from '../../ranking/fromScores.ts'
import { BAND_UI } from '../bands.ts'
import { Kao } from '../Kao.tsx'
import { MEDIA_LABEL, pluralWord } from '../meta.ts'
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
  /**
   * Starts a new Ranking, or continues the saved one. Undefined while it can't (e.g. saved progress is unreadable).
   * `fromScores`: start a new Ranking with Rough Sort from Scores (ADR 0008).
   */
  onStartRoughSort?: (fromScores?: boolean) => void
  /** Rough Sort from Scores for a new Ranking (null for a saved one); no card unless `offer`. */
  scoresPlan?: ScoresPlan | null
  /** Rough Sort progress of the Ranking saved for this Media Type, if there is one. */
  saved?: { done: number; total: number } | null
  /** Expected Duels from the saved Ranking's real Band sizes once its Rough Sort is done (#1 US8); else equal Bands are assumed. */
  bandDuels?: number | null
  /** Opens Restore from Backup (e.g. on a new browser). */
  onRestore?: () => void
}

/** Start = "Hero split" (issue #4): a cover collage on the left, one card on the right that holds login, then the Pool form. */
export function StartScreen(props: {
  form: PoolForm | null
  covers: readonly Cover[]
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

function Collage({ covers, viewer }: { covers: readonly Cover[]; viewer: Viewer | null }) {
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
  // The switch of the Rough Sort from Scores card: off by default; starting with it off declines (#32).
  const [fromScores, setFromScores] = useState(false)
  const plan = form.scoresPlan?.offerable ? form.scoresPlan : null
  const chosen = new Set(statuses)
  const label = (s: (typeof OFFERED_STATUSES)[number]) => statusLabel(s, mediaType)
  const n = pool?.titles.length ?? 0
  const duels = form.bandDuels ?? pool?.expectedDuels ?? 0

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
            {MEDIA_LABEL[type]}
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
            <b>{n}</b> {pluralWord(n, 'title')} · about <b>{duels}</b> {pluralWord(duels, 'Duel')}
            <span className="small">
              ({form.bandDuels != null ? 'from your Band sizes, ' : ''}~{estimateMinutes(duels)} min at 3 s each, spread over
              as many sittings as you like)
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
      {plan && !form.saved && <ScoresOffer plan={plan} on={fromScores} onToggle={() => setFromScores((on) => !on)} />}
      <button
        className="go"
        disabled={!form.onStartRoughSort || (!form.saved && (!pool || n === 0))}
        onClick={() => form.onStartRoughSort?.(Boolean(plan) && fromScores)}
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

/**
 * The Rough Sort from Scores offer (ADR 0008, decided on #32): a switch card under the estimate. When on, it shows
 * the per-Band preview, a "no score" row for titles still sorted by hand, the drawback, and below 80% scored a red
 * warning (the subtitle says "not recommended" even while off).
 */
function ScoresOffer({ plan, on, onToggle }: { plan: ScoresPlan; on: boolean; onToggle: () => void }) {
  const unscored = plan.total - plan.scored
  const largest = Math.max(...plan.counts, unscored, 1)
  const percent = Math.floor((plan.scored / plan.total) * 100)
  return (
    <div className={on ? 'offer on' : 'offer'}>
      <button className="swrow" role="switch" aria-checked={on} onClick={onToggle}>
        <span className="switch" aria-hidden="true">
          <i />
        </span>
        <span className="grow">
          <b className="strong">Use my AniList scores for Rough Sort</b>
          <span className="small">
            {plan.scored} of {plan.total} titles have a score
            {plan.belowThreshold && (
              <>
                {' · '}
                <span className="red">not recommended</span>
              </>
            )}
          </span>
        </span>
      </button>
      {on && (
        <div className="det">
          <div className="bbars" aria-label="Titles per Band">
            {BANDS.map((band) => (
              <div className="bb" key={band}>
                <Kao band={band} size={10} />
                <div className="track">
                  <i style={{ width: `${(plan.counts[band] / largest) * 100}%`, background: BAND_UI[band].colour }} />
                </div>
                <b>{plan.counts[band]}</b>
              </div>
            ))}
            {unscored > 0 && (
              <div className="bb">
                <span className="kao noscore">no score</span>
                <div className="track dashed" />
                <b>{unscored}</b>
              </div>
            )}
          </div>
          {plan.belowThreshold && (
            <div className="redwarn" role="alert">
              <b>Not recommended.</b> Only {percent}% of your titles have a score, so {unscored} still need Rough Sort by
              hand, and the Bands are guessed from few scores.
            </div>
          )}
          <div className="small">
            Titles in different Bands are never compared. You'll check the Bands on the Board before Duels start.
          </div>
        </div>
      )}
    </div>
  )
}
