import { useEffect, useEffectEvent, useState, type DragEvent, type ReactNode } from 'react'
import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import {
  BANDS,
  SUB_BANDS,
  type BandIndex,
  type BandState,
  type LogEvent,
  type RankingState,
  type SubBandIndex,
} from '../../ranking/engine.ts'
import { LOW_SAVINGS, defaultCuts, offerSavings, quarterSplit, splitSavings, worstCaseDuels, type SegmentSize } from '../../ranking/split.ts'
import { BAND_UI, SUB_BAND_UI } from '../bands.ts'
import { Dialog } from '../Dialog.tsx'
import { Kao, SubPill } from '../Kao.tsx'
import { titleName } from '../meta.ts'
import './split.css'

type BandSplitEvent = Extract<LogEvent, { type: 'band-split' }>

/** Worst-case Duels left in a Band, Sub-band by Sub-band once it is split. */
function bandWorstCase(band: BandState): number {
  const parts = band.subBands ?? [band]
  return worstCaseDuels(parts.map((p) => ({ places: p.tiers.length, unplaced: p.unplaced.length })))
}

/**
 * Whether the Band's ranked titles need the "Already ranked" strip with dividers. A Band fresh from Rough Sort
 * has one placed title (the first needs no Duel); that single Tier is shown as a cover in the columns instead,
 * and the column it ends up in decides the cut points.
 */
const needsStrip = (band: BandState) => band.tiers.length > 1 || (band.tiers[0]?.length ?? 0) > 1

/** Cut points that put a Band's single Tier into the given Sub-band. */
const LONE_TIER_CUTS: Record<SubBandIndex, [number, number]> = { 0: [1, 1], 1: [0, 1], 2: [0, 0] }

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

function useKey(handler: (e: KeyboardEvent) => void) {
  const onKey = useEffectEvent(handler)
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

/** Bars per Band (and per Sub-band once split), with the "Duels pile up" line at 40 titles. */
function SplitChart(props: { state: RankingState; split?: BandIndex; over?: BandIndex }) {
  const { state, split, over } = props
  const bars: { key: string; count: number; colour: string; label: ReactNode; over?: boolean }[] = []
  for (const band of BANDS) {
    const b = state.bands[band]
    if (band === split && b.subBands) {
      SUB_BANDS.forEach((sub) => {
        const part = b.subBands![sub]
        bars.push({
          key: `${band}-${sub}`,
          count: sum(part.tiers.map((t) => t.length)) + part.unplaced.length,
          colour: SUB_BAND_UI[sub].colour,
          label: <SubPill sub={sub} size={10} />,
        })
      })
    } else {
      bars.push({
        key: String(band),
        count: state.progress.bands[band].total,
        colour: BAND_UI[band].colour,
        label: <Kao band={band} size={10} />,
        over: band === over,
      })
    }
  }
  const height = (n: number) => (Math.min(n, 150) / 150) * 200
  return (
    <div className="spchart">
      <div className="bars">
        <div className="line" style={{ bottom: height(40) }}>
          <span>above ~40 titles, Duels pile up fast</span>
        </div>
        {bars.map((bar) => (
          <div key={bar.key} className="c1">
            <span className="cnt">{bar.count}</span>
            <div className={bar.over ? 'barv over' : 'barv'} style={{ height: height(bar.count), background: bar.colour }} />
          </div>
        ))}
      </div>
      <div className="labs">
        {bars.map((bar) => (
          <span key={bar.key}>{bar.label}</span>
        ))}
      </div>
    </div>
  )
}

function Cover(props: { id: number; entry: ListEntry | undefined; titleLanguage: TitleLanguage; children?: ReactNode; ranked?: boolean }) {
  const { id, entry, titleLanguage, children, ranked } = props
  const name = titleName(entry, id, titleLanguage)
  return (
    <>
      {entry?.coverUrl ? (
        <img className="cv" src={entry.coverUrl} alt="" draggable={false} style={{ background: entry.coverColor ?? undefined }} />
      ) : (
        <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
      )}
      {ranked && <span className="rk">ranked</span>}
      <span className="tt" title={name}>
        {name}
      </span>
      {children}
    </>
  )
}

/**
 * "Already ranked" strip (not in the prototype): the Band's Tiers in their current order, each tinted by the
 * Sub-band it falls in, with two dividers that sit on Tier edges. Drag a divider onto a gap, or focus it and
 * use ← / →. A divider starts at ¼ / ¾ of the titles, snapped to the nearest Tier edge.
 */
function RankedStrip(props: {
  band: BandState
  cuts: [number, number]
  onCuts: (cuts: [number, number]) => void
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
}) {
  const { band, cuts, onCuts, entries, titleLanguage } = props
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const [overEdge, setOverEdge] = useState<number | null>(null)
  const last = band.tiers.length
  const move = (which: 0 | 1, edge: number) => {
    const e = Math.max(0, Math.min(last, edge))
    onCuts(which === 0 ? [e, Math.max(e, cuts[1])] : [Math.min(cuts[0], e), e])
  }
  const subOf = (t: number): SubBandIndex => (t < cuts[0] ? 0 : t < cuts[1] ? 1 : 2)
  const name = (id: number) => titleName(entries.get(id), id, titleLanguage)
  const edge = (e: number) => (
    <div
      key={`edge-${e}`}
      className={overEdge === e ? 'edge over' : 'edge'}
      onDragOver={(ev) => {
        if (dragging === null) return
        ev.preventDefault()
        setOverEdge(e)
      }}
      onDragLeave={() => setOverEdge(null)}
      onDrop={(ev) => {
        ev.preventDefault()
        if (dragging !== null) move(dragging, e)
        setDragging(null)
        setOverEdge(null)
      }}
    >
      {([0, 1] as const)
        .filter((which) => cuts[which] === e)
        .map((which) => (
          <button
            key={which}
            className="divider"
            draggable
            aria-label={`${which === 0 ? 'Best / Middle' : 'Middle / Lowest'} divider, after ${e} of ${last} Tiers. Use left and right arrows to move it.`}
            onDragStart={(ev) => {
              ev.dataTransfer.setData('text/plain', `divider-${which}`)
              ev.dataTransfer.effectAllowed = 'move'
              setDragging(which)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOverEdge(null)
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
                ev.preventDefault()
                ev.stopPropagation()
                move(which, e + (ev.key === 'ArrowLeft' ? -1 : 1))
              }
            }}
          >
            <span>{which === 0 ? '▲ Best' : '▲ Middle'}</span>
            <span>{which === 0 ? 'Middle ▼' : 'Lowest ▼'}</span>
          </button>
        ))}
    </div>
  )
  return (
    <div className="spstrip">
      <div className="row">
        <b className="strong">Already ranked</b>
        <span className="small fine">
          Their order stays. Drag the two dividers (or focus one and press ← / →) to choose where Best and Lowest end.
        </span>
      </div>
      <div className="strip">
        {edge(0)}
        {band.tiers.map((tier, t) => [
          <div key={tier[0]} className="stier" style={{ ['--b' as string]: SUB_BAND_UI[subOf(t)].colour }} title={tier.map(name).join(' = ')}>
            {tier.slice(0, 3).map((id) => (
              <div key={id} className="pc">
                <Cover id={id} entry={entries.get(id)} titleLanguage={titleLanguage} />
              </div>
            ))}
            {tier.length > 3 && <span className="more">+{tier.length - 3}</span>}
          </div>,
          edge(t + 1),
        ])}
      </div>
    </div>
  )
}

/**
 * Split an oversized Band into Best / Middle / Lowest (issue #4 prototype R11-R13, ADR 0006).
 * offer → three columns (+ "Already ranked" strip when the Band has ranked titles) → done.
 * Keys: Enter = Split / Done / Start Duels.
 */
export function SplitScreen(props: {
  state: RankingState
  band: BandIndex
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  onSplit: (event: BandSplitEvent) => void
  /** "Keep it as it is" on the offer. */
  onSkip: () => void
  /** "Start Duels" once split. */
  onClose: () => void
  /** What closing leads to: Duels, or the last-check Board first (#34), when the button just says "Continue". */
  nextStep?: 'duels' | 'last-check'
}) {
  const { state, band, entries, titleLanguage, onSplit, onSkip, onClose, nextStep = 'duels' } = props
  const b = state.bands[band]
  const label = BAND_UI[band].label
  const [phase, setPhase] = useState<'offer' | 'split'>('offer')
  const strip = needsStrip(b)
  const [cuts, setCuts] = useState<[number, number]>(() => defaultCuts(b.tiers.map((t) => t.length)))
  // Where each title starts: everything unplaced in Middle; a single ranked Tier too.
  const [columnOf, setColumnOf] = useState<ReadonlyMap<number, SubBandIndex>>(() => new Map(b.unplaced.map((id) => [id, 1])))
  const [loneSub, setLoneSub] = useState<SubBandIndex>(1)
  const [warning, setWarning] = useState(false)
  const [overColumn, setOverColumn] = useState<SubBandIndex | null>(null)

  const loneTier = !strip && b.tiers.length === 1 ? b.tiers[0] : null
  const effectiveCuts = strip ? cuts : loneTier ? LONE_TIER_CUTS[loneSub] : ([0, 0] as [number, number])
  const columns = SUB_BANDS.map((sub) => b.unplaced.filter((id) => (columnOf.get(id) ?? 1) === sub))
  const places = [effectiveCuts[0], effectiveCuts[1] - effectiveCuts[0], b.tiers.length - effectiveCuts[1]]
  const whole: SegmentSize = { places: b.tiers.length, unplaced: b.unplaced.length }
  const parts = SUB_BANDS.map((sub) => ({ places: places[sub], unplaced: columns[sub].length })) as [SegmentSize, SegmentSize, SegmentSize]
  const liveSavings = splitSavings(whole, parts)
  const quarterSavings = (() => {
    const [q1, q2, q3] = quarterSplit(b.unplaced.length)
    return splitSavings(whole, [
      { places: places[0], unplaced: q1 },
      { places: places[1], unplaced: q2 },
      { places: places[2], unplaced: q3 },
    ])
  })()
  const allNow = sum(state.bands.map(bandWorstCase))
  const thisNow = bandWorstCase(b)

  const moveTo = (id: number, sub: SubBandIndex) => {
    if (loneTier?.includes(id)) setLoneSub(sub)
    else setColumnOf((prev) => new Map(prev).set(id, sub))
  }

  function finish() {
    onSplit({ type: 'band-split', band, cuts: effectiveCuts, unplaced: [columns[0], columns[1], columns[2]] })
  }

  function done() {
    if (liveSavings < LOW_SAVINGS) setWarning(true)
    else finish()
  }

  const isDone = Boolean(b.subBands)
  useKey((e) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button, a, [contenteditable]')) return
    e.preventDefault()
    if (isDone) onClose()
    else if (phase === 'offer') setPhase('split')
    else done()
  })

  if (isDone) {
    const after = bandWorstCase(b)
    // Choosing a split Band starts at its first Sub-band with titles to place.
    const first = SUB_BANDS.find((sub) => (b.subBands?.[sub].unplaced.length ?? 0) > 0) ?? null
    return (
      <div className="sppage">
        <div className="h1 row">
          {label} is split <Kao band={band} size={18} />
        </div>
        <div className="sub">
          Up to <b>{after}</b> Duels to go in {label}, Sub-band by Sub-band.
        </div>
        <SplitChart state={state} split={band} />
        <button className="go" onClick={onClose}>
          {first !== null && nextStep === 'duels' ? `Start Duels in ${label} › ${SUB_BAND_UI[first].label}` : 'Continue'} <span className="kbd">Enter</span>
        </button>
        <div className="small">
          {label} stays one row in the sidebar; its bar is striped by Sub-band. Duels go Best → Middle → Lowest.
        </div>
      </div>
    )
  }

  if (phase === 'offer') {
    const offer = offerSavings(b)
    return (
      <div className="sppage">
        <div className="h1">Your Bands are lopsided</div>
        <div className="sub">Duels only happen inside a Band, and one big Band costs far more Duels than a few small ones.</div>
        <SplitChart state={state} over={band} />
        <div className="spcount">
          <b className="strong">Split {label} into Best / Middle / Lowest?</b>
          <div className="small">
            Mark the ones that are your very best and the ones that are only just {label}. Everything you leave alone stays in the
            middle.
          </div>
          <div className="spnums">
            <div>
              <b>{allNow}</b> Duels now, at most
            </div>
            <div className="eq">→</div>
            <div className="good">
              <b>{allNow - offer}</b> after splitting · up to −{offer} Duels
            </div>
          </div>
          <div className="small fine">With Tiers ("about the same"), the real savings run about 15–30% lower.</div>
          <div className="row">
            <button className="go" onClick={() => setPhase('split')}>
              Split {label} <span className="kbd">Enter</span>
            </button>
            <button className="link" onClick={onSkip}>
              Keep it as it is
            </button>
          </div>
        </div>
      </div>
    )
  }

  const card = (id: number, sub: SubBandIndex, ranked = false) => (
    <div
      key={id}
      className="pc"
      draggable
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData('text/plain', String(id))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <Cover id={id} entry={entries.get(id)} titleLanguage={titleLanguage} ranked={ranked}>
        <span className="arrows">
          {sub > 0 && (
            <button aria-label={`Move up to ${SUB_BAND_UI[(sub - 1) as SubBandIndex].label}`} onClick={() => moveTo(id, (sub - 1) as SubBandIndex)}>
              ↑
            </button>
          )}
          {sub < 2 && (
            <button aria-label={`Move down to ${SUB_BAND_UI[(sub + 1) as SubBandIndex].label}`} onClick={() => moveTo(id, (sub + 1) as SubBandIndex)}>
              ↓
            </button>
          )}
        </span>
      </Cover>
    </div>
  )
  const counts = SUB_BANDS.map((sub) => columns[sub].length + (loneTier && loneSub === sub ? loneTier.length : 0))

  return (
    <div className="sppaint">
      <div className="row sphead">
        <div className="col grow" style={{ gap: 2 }}>
          <b className="strong">Sort {label} into 3 columns</b>
          <span className="small">
            Everything starts in Middle. Drag a cover to Best or Lowest, or use its ↑ ↓ buttons. Aim for about a quarter in each.
          </span>
        </div>
        {SUB_BANDS.map((sub) => (
          <SubPill key={sub} sub={sub} size={12}>
            {SUB_BAND_UI[sub].label} {counts[sub]}
          </SubPill>
        ))}
        <span className={liveSavings < LOW_SAVINGS ? 'livesave low' : 'livesave'} aria-live="polite">
          up to −{liveSavings} Duels
        </span>
        <button className="go sm" onClick={done}>
          Done <span className="kbd">Enter</span>
        </button>
      </div>
      {strip && <RankedStrip band={b} cuts={cuts} onCuts={setCuts} entries={entries} titleLanguage={titleLanguage} />}
      <div className="spcols">
        {SUB_BANDS.map((sub) => (
          <div
            key={sub}
            className={overColumn === sub ? 'spcol over' : 'spcol'}
            style={{ ['--b' as string]: SUB_BAND_UI[sub].colour }}
            onDragOver={(e) => {
              e.preventDefault()
              setOverColumn(sub)
            }}
            onDragLeave={() => setOverColumn(null)}
            onDrop={(e) => {
              e.preventDefault()
              setOverColumn(null)
              const id = Number(e.dataTransfer.getData('text/plain'))
              if (b.unplaced.includes(id) || loneTier?.includes(id)) moveTo(id, sub)
            }}
          >
            <div className="spcolh">
              <SubPill sub={sub} size={12} />
              <span className="small">{counts[sub]}</span>
            </div>
            <div className="pgrid">
              {loneTier && loneSub === sub && loneTier.map((id) => card(id, sub, true))}
              {columns[sub].map((id) => card(id, sub))}
              {counts[sub] === 0 && <div className="empty">drop covers here</div>}
            </div>
          </div>
        ))}
      </div>
      {warning && (
        <Dialog
          title={`Middle still has ${counts[1]} titles`}
          onCancel={() => setWarning(false)}
          actions={
            <>
              <button className="link" onClick={finish}>
                Finish anyway
              </button>
              <button className="go sm" onClick={() => setWarning(false)}>
                Keep sorting
              </button>
            </>
          }
        >
          <div>
            That only saves up to {liveSavings} Duels. Move a few more up to Best or down to Lowest and it saves a lot more: a
            quarter each way is up to −{quarterSavings}.
          </div>
        </Dialog>
      )}
      <div className="small fine">
        {label} has up to {thisNow} Duels to go as one Band.
      </div>
    </div>
  )
}
