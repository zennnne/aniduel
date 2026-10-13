import { useEffect, useRef, useState } from 'react'
import type { Cover, ListStatus, MediaType, Viewer } from '../../anilist/types.ts'
import { OFFERED_STATUSES, displayTitle, estimateMinutes, type Pool } from '../../pool/pool.ts'
import { BANDS, KEEP_MY_SCALE, type SortGoal } from '../../ranking/engine.ts'
import type { ScoresPlan } from '../../ranking/fromScores.ts'
import { hasHumanStep } from '../../ranking/scoring.ts'
import { BAND_UI } from '../bands.ts'
import { Kao } from '../Kao.tsx'
import { MEDIA_LABEL, pluralWord } from '../meta.ts'
import { SortGoalSeg, type KeepMyScaleButton } from '../SortGoalSeg.tsx'
import './start.css'
import { StartMochi, type StartCatchUp } from './StartMochi.tsx'
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
  /** Opens the Picker for a new Keep My Scale Ranking (#64). Undefined while it can't (e.g. saved progress is unreadable). */
  onChooseTitles?: () => void
  /** Rough Sort from Scores for a new Ranking (null for a saved one); no card unless `offer`. */
  scoresPlan?: ScoresPlan | null
  /** Rough Sort progress of the Ranking saved for this Media Type, if there is one. */
  saved?: { done: number; total: number } | null
  /** Expected Duels from the saved Ranking's real Band sizes once its Rough Sort is done (#1 US8); else equal Bands are assumed. */
  bandDuels?: number | null
  /** The Sort Goal shown (#28): the saved Ranking's, or the one a new Ranking will start on. */
  goal: SortGoal
  /** A new Ranking: just remembers the choice. A saved one: switches it (Full Ranking asks first). */
  onGoal: (goal: SortGoal) => void
  /** Expected Duels for the Pool under the shown Sort Goal, equal Bands assumed; null while the list is loading. */
  poolDuels: number | null
  /** About how many more Duels Full Ranking takes than Scores, for the long explanation; null if not known. */
  extraDuels: number | null
  /** Opens Restore from Backup (e.g. on a new browser). */
  onRestore?: () => void
  /** Catch-up's entry: the mochi over the card's corner (#52). */
  catchUp?: StartCatchUp
  /** Keep My Scale (ADR 0009); without it there is no third Sort Goal. */
  keepMyScale?: StartKeepMyScale
  /** The list status chips; hidden under Keep My Scale, whose Pool is picked in the Picker (ADR 0011). */
  statusChips: boolean
  /** What the main button does: continue the saved Ranking, start a new one with Rough Sort, or open the Picker (#64). */
  mainAction: 'continue' | 'start-rough-sort' | 'choose-titles'
  /** Keep My Scale chosen over a saved Ranking on another Sort Goal: the Picker's Confirm would replace it (#64). */
  replacesSaved: boolean
}

/** What Start shows of Keep My Scale (ADR 0009). */
export type StartKeepMyScale = KeepMyScaleButton & {
  /** Why it can't be chosen now, under the seg; null when it can (or is already chosen). */
  reason: string | null
  /** The Anchors picked titles are compared against. */
  anchors: number
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
        <div className="pwrap">
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
          {form?.catchUp && <StartMochi {...form.catchUp} />}
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
  // The switch of the Rough Sort from Scores card: off by default; starting with it off declines.
  const [fromScores, setFromScores] = useState(false)
  const plan = form.scoresPlan?.offerable ? form.scoresPlan : null
  const chosen = new Set(statuses)
  const label = (s: (typeof OFFERED_STATUSES)[number]) => statusLabel(s, mediaType)
  const n = pool?.titles.length ?? 0
  const duels = form.bandDuels ?? form.poolDuels ?? 0
  // Keep My Scale (ADR 0011): its Pool is picked in the Picker; a saved one can't switch Sort Goal.
  const onKeepMyScale = form.goal === KEEP_MY_SCALE
  const choosing = form.mainAction === 'choose-titles'

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
      {form.statusChips && (
        <>
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
        </>
      )}
      <div className="lab2">Sort Goal</div>
      <div className="goalrow">
        <SortGoalSeg goal={form.goal} onGoal={form.onGoal} keepMyScale={form.keepMyScale} locked={onKeepMyScale && Boolean(form.saved)} />
        <GoalInfo
          extraDuels={form.extraDuels}
          keepMyScaleOffered={Boolean(form.keepMyScale)}
          finerSteps={hasHumanStep(form.viewer.scoreFormat)}
        />
      </div>
      <span className="gexp">
        {GOAL_CAPTION[form.goal]}
        {form.goal === 'full-ranking' && !hasHumanStep(form.viewer.scoreFormat) && ' The scores come out the same as on Scores.'}
        {onKeepMyScale && form.saved ? (
          <>
            <br />
            <span className="fine">This Ranking can't switch to Scores or Full Ranking. Start it over to pick another Sort Goal.</span>
          </>
        ) : (
          form.keepMyScale?.reason && (
            <>
              <br />
              <span className="fine">🔒 Keep My Scale: {form.keepMyScale.reason}</span>
            </>
          )
        )}
      </span>
      {choosing ? (
        <div className="small">
          Next you choose the titles to score, with or without a score already. Each is compared with the scored titles
          you don't pick (your Anchors).
          {form.replacesSaved && ' Confirming your picks asks before your saved Ranking here is replaced.'}
        </div>
      ) : (
        <div className="est" aria-live="polite">
          {pool && onKeepMyScale ? (
            <>
              <b>{n}</b> {pluralWord(n, 'title')} to score · about <b>{duels}</b> {pluralWord(duels, 'Duel')}
              {form.saved ? ' left' : ''}
              <span className="small">
                (each against one of your {form.keepMyScale?.anchors ?? 0} Anchors, ~{estimateMinutes(duels)} min at 3 s each)
              </span>
            </>
          ) : pool ? (
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
      )}
      {form.saved && onKeepMyScale && (
        <div className="small">
          You have a saved Ranking here: {form.saved.done} of {form.saved.total} titles have a score. Your Anchors stay as
          they were when it started.
        </div>
      )}
      {form.saved && !onKeepMyScale && (
        <div className="small">
          You have a saved Ranking here: {form.saved.done} of {form.saved.total} titles have a Band. On Continue,
          titles that now match these statuses join Rough Sort and titles that no longer match leave the Ranking.
        </div>
      )}
      {plan && !form.saved && !onKeepMyScale && <ScoresOffer plan={plan} on={fromScores} onToggle={() => setFromScores((on) => !on)} />}
      {choosing ? (
        <button className="go" disabled={!form.onChooseTitles} onClick={form.onChooseTitles}>
          Choose titles →
        </button>
      ) : (
        <button
          className="go"
          disabled={!form.onStartRoughSort || (!form.saved && (!pool || n === 0))}
          onClick={() => form.onStartRoughSort?.(Boolean(plan) && fromScores && !onKeepMyScale)}
        >
          {form.mainAction === 'continue' ? 'Continue →' : 'Start Rough Sort →'}
        </button>
      )}
      {form.onRestore && (
        <button className="small link" style={{ alignSelf: 'flex-start' }} onClick={form.onRestore}>
          Restore from a Backup file
        </button>
      )}
      <Reassure />
    </>
  )
}

/** The one-line caption under the Sort Goal `seg`. */
const GOAL_CAPTION: Record<SortGoal, string> = {
  scores: 'Stops once every score is settled.',
  'full-ranking': 'Every title gets its own place.',
  [KEEP_MY_SCALE]: 'Scores the titles you pick against the ones you already scored. Every other score stays as it is.',
}

/**
 * The ⓘ beside the Sort Goal (#25): the long explanation. On desktop it shows while the pointer is over it; on touch
 * a tap opens it as a popover with ×, and a tap anywhere else closes it. `finerSteps`: the Score Format has more than
 * one Score Step, so Full Ranking can score finer than Scores.
 */
function GoalInfo(props: { extraDuels: number | null; keepMyScaleOffered: boolean; finerSteps: boolean }) {
  const { extraDuels, keepMyScaleOffered, finerSteps } = props
  // 'hover' follows the mouse; 'pinned' was opened by a tap or click and stays until closed.
  const [open, setOpen] = useState<'hover' | 'pinned' | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (open !== 'pinned') return
    const close = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(null)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <span
      className="iwrap"
      ref={wrap}
      onPointerEnter={(e) => e.pointerType === 'mouse' && !open && setOpen('hover')}
      onPointerLeave={(e) => e.pointerType === 'mouse' && open === 'hover' && setOpen(null)}
    >
      <button
        className={open ? 'info-i on' : 'info-i'}
        aria-label="Scores or Full Ranking?"
        aria-expanded={Boolean(open)}
        onClick={() => setOpen(open === 'pinned' ? null : 'pinned')}
      >
        i
      </button>
      {open && (
        <span className="ipop" role="tooltip">
          {open === 'pinned' && (
            <button className="x" aria-label="Close" onClick={() => setOpen(null)}>
              ×
            </button>
          )}
          {finerSteps ? (
            <>
              <b>Scores</b> (default from 100 titles): Duels stop once every title's score is settled. Whole points (8, not 8.5). Titles on
              the same score have no order among themselves.
              <br />
              <br />
              <b>Full Ranking</b> (default under 100 titles): every title gets its own place, even on the same score, and you can pick 0.5 or 0.1 steps.
            </>
          ) : (
            <>
              <b>Scores</b> (default): Duels stop once every title's score is settled. Titles on the same score have no
              order among themselves.
              <br />
              <br />
              <b>Full Ranking</b>: every title gets its own place, even on the same score. The scores come out the same
              as on Scores; only the order is extra.
            </>
          )}
          {extraDuels ? ` About ${extraDuels} more Duels.` : ''}
          <br />
          <br />
          Same Bands, same kind of Duels. Switch any time from the menu; no answer is lost.
          {keepMyScaleOffered && (
            <>
              <br />
              <br />
              <b>Keep My Scale</b>: the titles you pick, with or without a score, are each compared with the titles you
              already scored and didn't pick (your Anchors) and given one of your own scores. Every other score stays as
              it is. Chosen when a Ranking starts, and it can't switch later.
            </>
          )}
        </span>
      )}
    </span>
  )
}

/**
 * The Rough Sort from Scores offer (ADR 0008): a switch card under the estimate. When on, it shows
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
