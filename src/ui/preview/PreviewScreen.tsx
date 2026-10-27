import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ListEntry, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, KEEP_MY_SCALE, type RankingState, type SwitchableGoal } from '../../ranking/engine.ts'
import { refineDuels } from '../../ranking/estimate.ts'
import {
  isTicked,
  settledRows,
  suspectAnchors,
  type PreviewRead,
  type PreviewRow,
  type SettledRow,
  type TickOverrides,
  type UnsettledRow,
} from '../../ranking/preview.ts'
import { goalOf, isKeepMyScale, isScores } from '../../ranking/sortGoal.ts'
import {
  allowedLevels,
  changeSettings,
  formatLevel,
  hasHumanStep,
  isFirstCustomPick,
  levelOfRaw,
  levels,
  movedTitles,
  stepLabel,
  type Distribution,
  type QuartilePoint,
  type ScorePoint,
  type ScoringSettings,
  type SettingsChange,
} from '../../ranking/scoring.ts'
import { MOVE_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import { Select } from '../Select.tsx'
import { SortGoalSeg } from '../SortGoalSeg.tsx'
import { SCORE_FORMAT_LABEL } from './scoreFormat.ts'
import { keepMyScaleUnsettledSummary, unsettledSummary } from './unsettledCard.ts'
import './preview.css'
import { count, titleName } from '../meta.ts'


type Filter = 'changing' | 'all'

const DISTRIBUTION_LABEL: Record<Distribution, string> = { linear: 'Linear', bell: 'Bell', custom: 'Custom' }

/** The Quartile score selects under Custom, top of the scale first (#84: no "Quartile" in the UI). */
const QUARTILE_SELECTS: readonly (readonly [QuartilePoint, string, (level: number) => SettingsChange])[] = [
  ['p25', 'Top 25%', (p25) => ({ p25 })],
  ['p50', 'Middle', (p50) => ({ p50 })],
  ['p75', 'Top 75%', (p75) => ({ p75 })],
]

/** The first pick of Custom (#81, story 2 vs 9): the Distribution it started from and how many titles moved. */
type FirstPick = { from: Distribution; moved: number }

/** The first-pick bubble's width, its room from the screen's edges, and its gap under Custom for the arrow (#84). */
const BUBBLE_WIDTH = 280
const BUBBLE_EDGE = 8
const BUBBLE_GAP = 10

/**
 * Preview ("score rows", issue #4): best / worst / Distribution (Custom adds a row with its three Quartile scores,
 * ADR 0014, #85), one row per score level with the covers
 * that get it, each Band's level range, and the Forgotten titles. Everything recomputes live.
 * Re-rank, Move Band, Bring back and Import are disabled while their handler is not passed (Import while one runs).
 * On Scores, titles a settings change left unsettled show in an orange card instead, with the way to their Refine
 * Duels (#25, #29); every settled title can still be imported.
 * Keep My Scale (ADR 0009): only picked titles, grouped by the Anchor score they settled on; no settings, Sort Goal,
 * filter, Band or Move Band (Re-rank asks a picked title's Duels again), and Preview opens at any point of the Duels.
 * Its Suspect Anchors (#47) are listed read-only under the score rows, above the Forgotten titles.
 */
export function PreviewScreen(props: {
  state: RankingState
  /** `state` read into Preview rows and the Import plan, under `settings` and `overrides`. */
  preview: PreviewRead
  entries: ReadonlyMap<number, ListEntry>
  /** Old AniList score (100-point) of every title in the Pool; ranked titles missing here are never written. */
  oldScores: ReadonlyMap<number, number>
  titleLanguage: TitleLanguage
  format: ScoreFormat
  settings: ScoringSettings
  onSettings: (settings: ScoringSettings) => void
  overrides: TickOverrides
  onTick: (id: number, ticked: boolean) => void
  onImport?: () => void
  onRerank?: (id: number) => void
  onMove?: (id: number) => void
  onBringBack?: (id: number) => void
  /**
   * Asks to switch the Sort Goal, from the Sort Goal `seg` and the "Need 0.5? Switch to Full Ranking" caption under
   * Scores. To Full Ranking it opens the switch dialog (#25, #28). Without it there is no `seg` and the link is disabled.
   */
  onSwitchGoal?: (goal: SwitchableGoal) => void
  /** "Go to Duels →" on the unsettled card: the Refine Duels (#29). The button is disabled while it is not passed. */
  onRefine?: () => void
}) {
  const { state, entries, oldScores, titleLanguage, format, settings, onSettings, overrides, onTick } = props
  const onKeepMyScale = isKeepMyScale(state)
  // Keep My Scale shows every row: its titles had no score, so nearly all of them change.
  const [chosenFilter, setFilter] = useState<Filter>('changing')
  const filter: Filter = onKeepMyScale ? 'all' : chosenFilter
  const [open, setOpen] = useState<number | null>(null)
  const [showUnsettled, setShowUnsettled] = useState(false)

  const name = (id: number) => titleName(entries.get(id), id, titleLanguage)
  const { scores, rows: allRows, plan } = props.preview
  // Score rows hold settled titles only (#25); unsettled ones (Scores, after a settings change) are never ticked.
  const rows = settledRows(allRows)
  const changing = rows.filter((r) => r.changed).length
  const label = (level: number) => formatLevel(format, level)
  const unsettled = allRows.filter((r): r is UnsettledRow => !r.settled)
  const refine = useMemo(() => refineDuels(state), [state])
  const suspects = suspectAnchors(state, format)
  /** The levels an unsettled title can still get: "8 or 7", or "9–6" for more. */
  const between = (row: UnsettledRow) =>
    row.levels.length === 2 ? `${label(row.levels[0])} or ${label(row.levels[1])}` : `${label(row.levels[0])}–${label(row.levels[row.levels.length - 1])}`

  // Score rows: only levels that have titles, highest first. On Scores, `rows` is already sorted by name in a level.
  const byLevel = new Map<number, SettledRow[]>()
  for (const row of rows) byLevel.set(row.level, [...(byLevel.get(row.level) ?? []), row])
  const scoreRows = [...byLevel.entries()].sort((a, b) => b[0] - a[0])

  const options = levels(format, settings.step)
  const allowed = allowedLevels(settings, format)
  // The first-pick bubble: open from the first switch to Custom (Quartile scores filled in from the current
  // Distribution) until Got it, a click anywhere else, or any settings change, leaving Custom included.
  const [firstPick, setFirstPick] = useState<FirstPick | null>(null)
  const [bubblePlace, setBubblePlace] = useState<{ box: CSSProperties; arrow: number } | null>(null)
  /** Opens or closes the bubble; its place is measured again each time it opens, so a closed one keeps none. */
  const showFirstPick = (pick: FirstPick | null) => {
    setFirstPick(pick)
    setBubblePlace(null)
  }
  const change = (c: SettingsChange) => {
    const next = changeSettings(settings, format, c)
    showFirstPick(isFirstCustomPick(settings, c) ? { from: settings.distribution, moved: movedTitles(state, format, settings, next) } : null)
    if (next !== settings) onSettings(next) // rejected: the select snaps back to the saved value
  }
  const pv = useRef<HTMLDivElement>(null)
  const customButton = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!firstPick) return
    const place = () => {
      const box = pv.current?.getBoundingClientRect()
      const at = customButton.current?.getBoundingClientRect()
      if (!box || !at || !pv.current) return
      // Under Custom, kept inside the screen (8px from its edges), the arrow still at Custom's middle.
      const width = Math.min(BUBBLE_WIDTH, window.innerWidth - 2 * BUBBLE_EDGE)
      const middle = at.left + at.width / 2
      const left = Math.min(window.innerWidth - BUBBLE_EDGE - width, Math.max(BUBBLE_EDGE, middle - width / 2))
      setBubblePlace({
        box: { width, left: left - box.left + pv.current.scrollLeft, top: at.bottom - box.top + pv.current.scrollTop + BUBBLE_GAP },
        arrow: middle - left,
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [firstPick])
  useEffect(() => {
    if (!firstPick) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node && bubble.current?.contains(e.target))) showFirstPick(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && showFirstPick(null)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [firstPick])
  /** The Quartile scores, shown only under Custom. */
  const quartiles = settings.distribution === 'custom' ? settings.quartiles : undefined
  const choices = (point: ScorePoint) => options.map((l) => ({ value: l, label: label(l), disabled: !allowed[point]?.includes(l) }))

  const cover = (row: PreviewRow) => {
    const entry = entries.get(row.id)
    const ticked = isTicked(row, overrides)
    return (
      <div
        key={row.id}
        className={`tlcard${row.band === null ? '' : ` b${row.band}`}${ticked || !row.settled ? '' : ' off'}`}
        onClick={() => setOpen(open === row.id ? null : row.id)}
        title={name(row.id)}
      >
        {entry?.coverUrl ? (
          <img className="cv" src={entry.coverUrl} alt="" style={{ ['--c' as string]: entry.coverColor ?? undefined }} />
        ) : (
          <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
        )}
        {!row.settled && <span className="rbadge">{between(row)}</span>}
        <span className="ob">{row.oldLevel === null ? 'new' : `${label(row.oldLevel)}→`}</span>
        {open === row.id && (
          <div className="tlpop" onClick={(e) => e.stopPropagation()}>
            <b>{name(row.id)}</b>
            <span className="small">
              {row.band !== null && (
                <>
                  <Kao band={row.band} size={9} /> ·{' '}
                </>
              )}
              AniList {row.oldLevel === null ? 'no score' : label(row.oldLevel)} →{' '}
              <b>{row.settled ? label(row.level) : `${between(row)}?`}</b>
            </span>
            {!row.settled ? (
              <>
                <span className="small uns-why">
                  Not settled yet: a few {onKeepMyScale ? 'Duels' : 'Refine Duels'} decide between {between(row)}. Can't be
                  imported until then.
                </span>
                <label className="row small uns-off">
                  <input type="checkbox" checked={false} disabled /> Import this
                </label>
              </>
            ) : row.changed ? (
              <label className="row small">
                <input type="checkbox" checked={ticked} onChange={(e) => onTick(row.id, e.target.checked)} /> Import this
              </label>
            ) : (
              <span className="small">No change</span>
            )}
            <div className="row">
              <button className="mini-b" disabled={!props.onRerank} onClick={() => props.onRerank?.(row.id)}>
                Re-rank
              </button>
              {!onKeepMyScale && (
                <button className="mini-b" disabled={!props.onMove} onClick={() => props.onMove?.(row.id)} title="Move Band">
                  {MOVE_ICON}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pv" ref={pv}>
      <div className="pv-head">
        <div>
          <div className="h1">Preview</div>
          <div className="small">
            {onKeepMyScale
              ? `${rows.length} ${rows.length === 1 ? 'title' : 'titles'} scored`
              : `${rows.length} ranked · ${changing} change at your Score Format`}{' '}
            · {plan.length} ticked for Import
            {unsettled.length > 0 && (
              <>
                {' '}
                · <b className="strong">{unsettled.length} not settled</b>
              </>
            )}
          </div>
        </div>
        <div className="grow" />
        <button className="go" disabled={!props.onImport || plan.length === 0} onClick={props.onImport}>
          Import {count(plan.length, 'score')} →
        </button>
      </div>

      {onKeepMyScale ? (
        <div className="pv-set">
          <span className="small">
            Keep My Scale · Score Format: {SCORE_FORMAT_LABEL[format]} · your {state.keepMyScale?.anchorCount} Anchors are
            never changed
          </span>
        </div>
      ) : (
        <div className="pv-set">
          <span className="pv-lab">
            Best
            <Select
              label="Best"
              value={settings.best}
              options={choices('best')}
              onChange={(l) => change({ best: l })}
            />
          </span>
          <span className="pv-lab">
            Worst
            <Select
              label="Worst"
              value={settings.worst}
              options={choices('worst')}
              onChange={(l) => change({ worst: l })}
            />
          </span>
          <div className="seg">
            {(['linear', 'bell', 'custom'] as const).map((d) => (
              <button
                key={d}
                ref={d === 'custom' ? customButton : undefined}
                className={settings.distribution === d ? 'on' : ''}
                onClick={() => change({ distribution: d })}
              >
                {DISTRIBUTION_LABEL[d]}
              </button>
            ))}
          </div>
          {props.onSwitchGoal && <SortGoalSeg goal={goalOf(state)} onGoal={(goal) => goal !== KEEP_MY_SCALE && props.onSwitchGoal?.(goal)} />}
          {hasHumanStep(format) && isScores(state) && (
            // Scores always uses whole points (ADR 0007): the Step is locked on Whole, and the caption gives the way out (#25).
            <>
              <div className="seg lock" title="Score Step: Scores always uses whole points">
                {(['whole', 'human', 'fine'] as const).map((s) => (
                  <button key={s} className={s === 'whole' ? 'on' : ''} disabled>
                    {s === 'whole' ? 'Whole' : stepLabel(format, s)}
                  </button>
                ))}
              </div>
              <span className="small">
                Need {stepLabel(format, 'human')}?{' '}
                <button className="link small" disabled={!props.onSwitchGoal} onClick={() => props.onSwitchGoal?.('full-ranking')}>
                  Switch to Full Ranking
                </button>
              </span>
            </>
          )}
          {hasHumanStep(format) && !isScores(state) && (
            <div className="seg" title="Score Step">
              {(['fine', 'human'] as const).map((s) => (
                <button key={s} className={settings.step === s ? 'on' : ''} onClick={() => change({ step: s })}>
                  {stepLabel(format, s)}
                </button>
              ))}
            </div>
          )}
          <span className="small">Score Format: {SCORE_FORMAT_LABEL[format]}</span>
        </div>
      )}

      {!onKeepMyScale && quartiles && (
        // Custom's second row (#84): hidden under Linear and Bell.
        <div className="pv-quart">
          {QUARTILE_SELECTS.map(([point, text, pick]) => (
            <span key={point} className="pv-lab">
              {text}
              <Select label={text} value={quartiles[point]} options={choices(point)} onChange={(l) => change(pick(l))} />
            </span>
          ))}
          <span className="small pv-quart-how">Straight lines from Best through these to Worst</span>
        </div>
      )}

      {firstPick && (
        <div
          ref={bubble}
          className="pv-bubble"
          role="dialog"
          aria-label={`Custom starts where ${DISTRIBUTION_LABEL[firstPick.from]} was`}
          style={bubblePlace?.box ?? { visibility: 'hidden' }}
        >
          <i className="pv-bubble-arrow" aria-hidden="true" style={{ left: bubblePlace?.arrow }} />
          <b>Custom starts where {DISTRIBUTION_LABEL[firstPick.from]} was</b>
          <span>
            {firstPick.moved > 0 &&
              (firstPick.from === 'bell'
                ? `Custom uses straight lines between its points, which can't follow Bell's curve, so ${count(firstPick.moved, 'title')} moved. `
                : `Its three points sit on your Score Step, so ${count(firstPick.moved, 'title')} moved by one step. `)}
            Change Top 25%, Middle or Top 75% to shape your scores.
          </span>
          <button className="go sm" onClick={() => showFirstPick(null)}>
            Got it
          </button>
        </div>
      )}

      {unsettled.length > 0 && (
        // Never on Full Ranking: every title there has a level (#25).
        <div className="unscard">
          <span className="unsicon" aria-hidden>
            ⚠
          </span>
          <span className="small strong grow">
            {onKeepMyScale
              ? keepMyScaleUnsettledSummary(unsettled.length, state.prompt.kind !== 'all-complete')
              : unsettledSummary(unsettled.length, refine)}{' '}
            ·{' '}
            <button className="link small" onClick={() => setShowUnsettled(!showUnsettled)}>
              {showUnsettled ? 'hide' : 'show'}
            </button>
          </span>
          <button className="go sm" disabled={!props.onRefine} onClick={props.onRefine}>
            Go to Duels →
          </button>
          {showUnsettled && <div className="unscovers">{unsettled.map(cover)}</div>}
        </div>
      )}

      {!onKeepMyScale && (
        <div className="seg pv-filter">
          <button className={filter === 'changing' ? 'on' : ''} onClick={() => setFilter('changing')}>
            Changing ({changing})
          </button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            All ({rows.length})
          </button>
        </div>
      )}

      <div className="tl">
        {scoreRows.map(([level, members]) => {
          const shown = filter === 'all' ? members : members.filter((r) => r.changed)
          if (shown.length === 0) {
            return (
              <div key={level} className="tlrow coll">
                <div className="tlk">{label(level)}</div>
                <div className="tlc">
                  {members.length} unchanged ·{' '}
                  <button className="link" onClick={() => setFilter('all')}>
                    show
                  </button>
                </div>
              </div>
            )
          }
          return (
            <div key={level} className="tlrow">
              <div className="tlk">
                {label(level)}
                <span className="small">{members.length}</span>
              </div>
              <div className="tlc">{shown.map(cover)}</div>
            </div>
          )
        })}
      </div>

      {!onKeepMyScale && (
        <div className="rng">
          {BANDS.map((band) => {
            const range = scores.bands[band]
            return (
              <span key={band}>
                <Kao band={band} size={10} /> spans{' '}
                <b>{range === null ? '—' : range.min === range.max ? label(range.min) : `${label(range.min)}–${label(range.max)}`}</b>
              </span>
            )
          })}
        </div>
      )}

      {suspects.length > 0 && (
        <div className="forg">
          <b className="strong">Suspect Anchors ({suspects.length}) — no longer used as a reference, score kept</b>
          {/* ADR 0011: a picked title is scored again, so this is how a Suspect Anchor gets fixed. */}
          <span className="small">To fix one, pick it in your next Keep My Scale Ranking.</span>
          {suspects.map(({ id, level, contradicted }) => {
            const entry = entries.get(id)
            return (
              <div key={id} className="frow">
                {entry?.coverUrl ? <img className="cv" src={entry.coverUrl} alt="" /> : <div className="cv ph" />}
                <span className="grow">
                  {name(id)}
                  <br />
                  <span className="small">Your Duels disagreed with its score for {count(contradicted, 'title')}</span>
                </span>
                <span className="small">Your score: {label(level)}</span>
                {entry?.siteUrl && (
                  <a className="mini-b" href={entry.siteUrl} target="_blank" rel="noreferrer" aria-label={`Open ${name(id)} on AniList`}>
                    AniList
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}

      {state.forgotten.length > 0 && (
        <div className="forg">
          <b className="strong">Forgotten ({state.forgotten.length}) — never written, AniList score kept</b>
          {state.forgotten.map((id) => {
            const entry = entries.get(id)
            const old = levelOfRaw(format, oldScores.get(id) ?? entry?.oldScore100 ?? 0)
            return (
              <div key={id} className="frow">
                {entry?.coverUrl ? <img className="cv" src={entry.coverUrl} alt="" /> : <div className="cv ph" />}
                <span className="grow">{name(id)}</span>
                <span className="small">AniList: {old === 0 ? 'no score' : label(old)}</span>
                <button className="mini-b" disabled={!props.onBringBack} onClick={() => props.onBringBack?.(id)}>
                  Bring back
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
