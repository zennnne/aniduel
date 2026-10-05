import { useEffect, useEffectEvent, useState } from 'react'
import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { displayTitle } from '../../pool/pool.ts'
import { BANDS, SUB_BANDS, type BandIndex, type RankingState } from '../../ranking/engine.ts'
import { duelsLeft } from '../../ranking/estimate.ts'
import { BAND_UI, SUB_BAND_UI } from '../bands.ts'
import { UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import './bandchoice.css'

/** A Band's progress bar; a split Band's bar is striped, one stripe per Sub-band, each filled by its own progress. */
export function BandBar({ state, band }: { state: RankingState; band: BandIndex }) {
  const b = state.bands[band]
  const placed = (tiers: readonly (readonly number[])[]) => tiers.reduce((n, tier) => n + tier.length, 0)
  if (b.subBands) {
    return (
      <div className="prog segs" title="Best / Middle / Lowest">
        {SUB_BANDS.map((sub) => {
          const part = b.subBands![sub]
          const done = placed(part.tiers)
          const total = done + part.unplaced.length
          return (
            <span key={sub} style={{ flex: Math.max(total, 1), background: SUB_BAND_UI[sub].colour }}>
              <i style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
            </span>
          )
        })}
      </div>
    )
  }
  const { done, total } = state.progress.bands[band]
  return (
    <div className={done === total ? 'prog full' : 'prog'}>
      <i style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
    </div>
  )
}

/**
 * Band choice = "result + chooser" (issue #4, B5): after Rough Sort and whenever a Band is finished, the user picks
 * which Band to Duel in next. The suggested Band (the top one with titles to place) is pre-selected.
 * Keys: 1-5 pick a Band, ↑ / ↓ move the selection, Enter continues, Backspace undoes.
 */
export function BandChoiceScreen(props: {
  state: RankingState
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  /** The Band that was just finished, to show its order; null right after Rough Sort or when opened by hand. */
  finished: BandIndex | null
  /** Pre-selected Band. */
  next: BandIndex
  onChoose: (band: BandIndex) => void
  onUndo: () => void
}) {
  const { state, entries, titleLanguage, finished, next, onChoose, onUndo } = props
  const open = BANDS.filter((band) => state.bands[band].unplaced.length > 0)
  const [selected, setSelected] = useState<BandIndex>(open.includes(next) ? next : (open[0] ?? next))
  const { done, total } = state.progress.ranked
  const toGo = open.reduce<number>((sum, band) => sum + duelsLeft(state.bands[band]), 0)
  const name = (id: number) => {
    const entry = entries.get(id)
    return entry ? displayTitle(entry.title, titleLanguage) : `Title #${id}`
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (e.key >= '1' && e.key <= '5') {
      const band = (Number(e.key) - 1) as BandIndex
      if (open.includes(band)) onChoose(band)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const at = open.indexOf(selected) + (e.key === 'ArrowDown' ? 1 : -1)
      const band = open[(at + open.length) % open.length]
      if (band !== undefined) setSelected(band)
    } else if (e.key === 'Enter') {
      if (e.target instanceof HTMLElement && e.target.closest('button, a')) return
      e.preventDefault()
      if (open.includes(selected)) onChoose(selected)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (state.canUndo) onUndo()
    }
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // Place of the finished Band's first Tier in the whole Ranking (a Tier is one place).
  const firstPlace = finished === null ? 1 : state.bands.slice(0, finished).reduce((sum, b) => sum + b.tiers.length, 1)

  return (
    <div className="bc">
      <div className="h1">Which Band next?</div>
      <div className="sub">
        {done}/{total} placed · about {toGo} {toGo === 1 ? 'Duel' : 'Duels'} to go
      </div>
      <div className="bc-total">
        <span className="small">Total</span>
        <div className={done === total ? 'prog full' : 'prog'}>
          <i style={{ width: `${total ? (done / total) * 100 : 100}%` }} />
        </div>
      </div>
      <div className={finished === null ? 'b-result solo' : 'b-result'}>
        {finished !== null && (
          <section className="res">
            <div className="row">
              <Kao band={finished} size={14} /> <b className="strong">{BAND_UI[finished].label} — your order</b>
            </div>
            {state.bands[finished].tiers.map((tier, i) => {
              const cover = entries.get(tier[0])
              return (
                <div key={tier[0]} className="ln">
                  <b>{firstPlace + i}</b>
                  {cover?.coverUrl ? (
                    <img className="cv" src={cover.coverUrl} alt="" style={{ background: cover.coverColor ?? undefined }} />
                  ) : (
                    <div className="cv ph" style={{ ['--c' as string]: cover?.coverColor ?? undefined }} />
                  )}
                  <span>
                    <b>{tier.map(name).join(', ')}</b>
                    {tier.length > 1 && <span className="tie"> Tier · same score</span>}
                  </span>
                </div>
              )
            })}
            <div className="small">Spot a mistake? Re-rank it later from Preview.</div>
          </section>
        )}
        <section className="ch">
          <b className="strong">Next Band</b>
          {BANDS.map((band) => {
            const p = state.progress.bands[band]
            const left = state.bands[band].unplaced.length
            return (
              <button
                key={band}
                className={band === selected ? 'on' : undefined}
                disabled={left === 0}
                onClick={() => onChoose(band)}
                onMouseEnter={() => left > 0 && setSelected(band)}
              >
                <span className="row">
                  <span className="kbd">{band + 1}</span>
                  <Kao band={band} size={12} />
                </span>
                <span className="col">
                  <span className="strong">
                    {BAND_UI[band].label}
                    {state.bands[band].subBands && <span className="small"> · Best → Middle → Lowest</span>}
                  </span>
                  <BandBar state={state} band={band} />
                </span>
                <span className="small">
                  {left === 0 ? (p.total ? 'done' : 'empty') : band === selected ? <b className="nx">next</b> : `${p.done}/${p.total}`}
                </span>
              </button>
            )
          })}
          <div className="row">
            <button className="go" onClick={() => onChoose(selected)} disabled={!open.includes(selected)}>
              Duel in {BAND_UI[selected].label} <span className="kbd">Enter</span>
            </button>
            <button className="go sm" onClick={onUndo} disabled={!state.canUndo}>
              {UNDO_ICON} Undo <span className="kbd">⌫</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
