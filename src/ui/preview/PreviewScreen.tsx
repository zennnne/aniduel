import { useMemo, useState } from 'react'
import type { ListEntry, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, type RankingState, type SortGoal } from '../../ranking/engine.ts'
import { importPlan, isTicked, previewRows, settledRows, type PendingWrite, type SettledRow, type TickOverrides } from '../../ranking/preview.ts'
import { goalOf } from '../../ranking/sortGoal.ts'
import { formatLevel, hasHumanStep, levelOfRaw, levels, score, stepLabel, withStep, type ScoringSettings } from '../../ranking/scoring.ts'
import { MOVE_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import { SortGoalSeg } from '../SortGoalSeg.tsx'
import { SCORE_FORMAT_LABEL } from './scoreFormat.ts'
import './preview.css'
import { count, titleName } from '../meta.ts'


type Filter = 'changing' | 'all'

/**
 * Preview ("score rows", issue #4): best / worst / Distribution, one row per score level with the covers
 * that get it, each Band's level range, and the Forgotten titles. Everything recomputes live.
 * Re-rank, Move Band, Bring back and Import are disabled while their handler is not passed (Import while one runs).
 */
export function PreviewScreen(props: {
  state: RankingState
  entries: ReadonlyMap<number, ListEntry>
  /** Old AniList score (100-point) of every title in the Pool; ranked titles missing here are never written. */
  oldScores: ReadonlyMap<number, number>
  titleLanguage: TitleLanguage
  format: ScoreFormat
  settings: ScoringSettings
  onSettings: (settings: ScoringSettings) => void
  overrides: TickOverrides
  onTick: (id: number, ticked: boolean) => void
  onImport?: (plan: PendingWrite[]) => void
  onRerank?: (id: number) => void
  onMove?: (id: number) => void
  onBringBack?: (id: number) => void
  /**
   * Asks to switch the Sort Goal, from the Sort Goal `seg` and the "Need 0.5? Switch to Full Ranking" caption under
   * Scores. To Full Ranking it opens the switch dialog (#25, #28). Without it there is no `seg` and the link is disabled.
   */
  onSwitchGoal?: (goal: SortGoal) => void
}) {
  const { state, entries, oldScores, titleLanguage, format, settings, onSettings, overrides, onTick } = props
  const [filter, setFilter] = useState<Filter>('changing')
  const [open, setOpen] = useState<number | null>(null)

  const name = (id: number) => titleName(entries.get(id), id, titleLanguage)
  const scores = useMemo(() => score(state, format, settings), [state, format, settings])
  const allRows = useMemo(
    () => previewRows(state, scores, oldScores, format, (id) => titleName(entries.get(id), id, titleLanguage)),
    [state, scores, oldScores, format, entries, titleLanguage],
  )
  const plan = importPlan(allRows, overrides)
  // Score rows hold settled titles only (#25); unsettled ones (Scores, after a settings change) are never ticked.
  const rows = settledRows(allRows)
  const changing = rows.filter((r) => r.changed).length
  const label = (level: number) => formatLevel(format, level)

  // Score rows: only levels that have titles, highest first. On Scores, `rows` is already sorted by name in a level.
  const byLevel = new Map<number, SettledRow[]>()
  for (const row of rows) byLevel.set(row.level, [...(byLevel.get(row.level) ?? []), row])
  const scoreRows = [...byLevel.entries()].sort((a, b) => b[0] - a[0])

  const options = levels(format, settings.step)
  const pick = (key: 'best' | 'worst', value: number) => {
    const next = { ...settings, [key]: value }
    if (next.worst >= next.best) return // rejected: the select snaps back to the saved value
    onSettings(next)
  }

  const cover = (row: SettledRow) => {
    const entry = entries.get(row.id)
    const ticked = isTicked(row, overrides)
    return (
      <div
        key={row.id}
        className={`tlcard b${row.band}${ticked ? '' : ' off'}`}
        onClick={() => setOpen(open === row.id ? null : row.id)}
        title={name(row.id)}
      >
        {entry?.coverUrl ? (
          <img className="cv" src={entry.coverUrl} alt="" style={{ ['--c' as string]: entry.coverColor ?? undefined }} />
        ) : (
          <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
        )}
        <span className="ob">{row.oldLevel === null ? 'new' : `${label(row.oldLevel)}→`}</span>
        {open === row.id && (
          <div className="tlpop" onClick={(e) => e.stopPropagation()}>
            <b>{name(row.id)}</b>
            <span className="small">
              <Kao band={row.band} size={9} /> · AniList {row.oldLevel === null ? 'no score' : label(row.oldLevel)} → <b>{label(row.level)}</b>
            </span>
            {row.changed ? (
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
              <button className="mini-b" disabled={!props.onMove} onClick={() => props.onMove?.(row.id)} title="Move Band">
                {MOVE_ICON}
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pv">
      <div className="pv-head">
        <div>
          <div className="h1">Preview</div>
          <div className="small">
            {rows.length} ranked · {changing} change at your Score Format · {plan.length} ticked for Import
          </div>
        </div>
        <div className="grow" />
        <button className="go" disabled={!props.onImport || plan.length === 0} onClick={() => props.onImport?.(plan)}>
          Import {count(plan.length, 'score')} →
        </button>
      </div>

      <div className="pv-set">
        <label>
          Best
          <select className="lsel" value={settings.best} onChange={(e) => pick('best', Number(e.target.value))}>
            {options.map((l) => (
              <option key={l} value={l} disabled={l <= settings.worst}>
                {label(l)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Worst
          <select className="lsel" value={settings.worst} onChange={(e) => pick('worst', Number(e.target.value))}>
            {options.map((l) => (
              <option key={l} value={l} disabled={l >= settings.best}>
                {label(l)}
              </option>
            ))}
          </select>
        </label>
        <div className="seg">
          {(['linear', 'bell'] as const).map((d) => (
            <button key={d} className={settings.distribution === d ? 'on' : ''} onClick={() => onSettings({ ...settings, distribution: d })}>
              {d === 'linear' ? 'Linear' : 'Bell'}
            </button>
          ))}
        </div>
        {props.onSwitchGoal && <SortGoalSeg goal={goalOf(state)} onGoal={props.onSwitchGoal} />}
        {hasHumanStep(format) && state.sortGoal === 'scores' && (
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
        {hasHumanStep(format) && state.sortGoal !== 'scores' && (
          <div className="seg" title="Score Step">
            {(['fine', 'human'] as const).map((s) => (
              <button key={s} className={settings.step === s ? 'on' : ''} onClick={() => onSettings(withStep(settings, format, s))}>
                {stepLabel(format, s)}
              </button>
            ))}
          </div>
        )}
        <span className="small">Score Format: {SCORE_FORMAT_LABEL[format]}</span>
      </div>

      <div className="seg pv-filter">
        <button className={filter === 'changing' ? 'on' : ''} onClick={() => setFilter('changing')}>
          Changing ({changing})
        </button>
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          All ({rows.length})
        </button>
      </div>

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
