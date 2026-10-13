import { useEffect, useEffectEvent, useState, type DragEvent, type ReactNode } from 'react'
import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { SUB_BANDS, type BandIndex, type RankingState, type SubBandIndex } from '../../ranking/engine.ts'
import { BAND_UI, SUB_BAND_UI } from '../bands.ts'
import { Dialog } from '../Dialog.tsx'
import { Kao, SubPill } from '../Kao.tsx'
import { titleName } from '../meta.ts'
import {
  keepSorting,
  moveDivider,
  moveTitle,
  splitView,
  startingChoices,
  takeOffer,
  type BandSplitEvent,
  type SplitBar,
  type SplitStrip,
} from './splitView.ts'
import './split.css'

function useKey(handler: (e: KeyboardEvent) => void) {
  const onKey = useEffectEvent(handler)
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

/** Bars per Band (and per Sub-band once split), with the "Duels pile up" line at 40 titles. */
function SplitChart(props: { bars: readonly SplitBar[] }) {
  const bars = props.bars.map((bar) => ({
    key: bar.subBand === null ? String(bar.band) : `${bar.band}-${bar.subBand}`,
    count: bar.count,
    colour: bar.subBand === null ? BAND_UI[bar.band].colour : SUB_BAND_UI[bar.subBand].colour,
    label: bar.subBand === null ? <Kao band={bar.band} size={10} /> : <SubPill sub={bar.subBand} size={10} />,
    over: bar.oversized,
  }))
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
  strip: SplitStrip
  /** A divider (0 = Best / Middle, 1 = Middle / Lowest) put on a Tier edge. */
  onMove: (divider: 0 | 1, edge: number) => void
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
}) {
  const { strip, onMove: move, entries, titleLanguage } = props
  const { tiers, cuts } = strip
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const [overEdge, setOverEdge] = useState<number | null>(null)
  const last = tiers.length
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
        {tiers.map(({ titles: tier, subBand }, t) => [
          <div key={tier[0]} className="stier" style={{ ['--b' as string]: SUB_BAND_UI[subBand].colour }} title={tier.map(name).join(' = ')}>
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
  /** What closing leads to: Duels, or the last-check Board first, when the button just says "Continue". */
  nextStep?: 'duels' | 'last-check'
}) {
  const { state, band, entries, titleLanguage, onSplit, onSkip, onClose, nextStep = 'duels' } = props
  const label = BAND_UI[band].label
  const [choices, setChoices] = useState(() => startingChoices(state, band))
  const [overColumn, setOverColumn] = useState<SubBandIndex | null>(null)
  const view = splitView({ state, band, choices })

  const moveTo = (id: number, sub: SubBandIndex) => setChoices((prev) => moveTitle({ state, band, choices: prev }, id, sub))

  function done() {
    if (view.step !== 'columns') return
    if (view.done.ask) setChoices(view.done.choices)
    else onSplit(view.done.event)
  }

  useKey((e) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, button, a, [contenteditable]')) return
    e.preventDefault()
    if (view.step === 'done') onClose()
    else if (view.step === 'offer') setChoices(takeOffer)
    else done()
  })

  if (view.step === 'done') {
    const first = view.firstSubBand
    return (
      <div className="sppage">
        <div className="h1 row">
          {label} is split <Kao band={band} size={18} />
        </div>
        <div className="sub">
          Up to <b>{view.duelsLeft}</b> Duels to go in {label}, Sub-band by Sub-band.
        </div>
        <SplitChart bars={view.bars} />
        <button className="go" onClick={onClose}>
          {first !== null && nextStep === 'duels' ? `Start Duels in ${label} › ${SUB_BAND_UI[first].label}` : 'Continue'} <span className="kbd">Enter</span>
        </button>
        <div className="small">
          {label} stays one row in the sidebar; its bar is striped by Sub-band. Duels go Best → Middle → Lowest.
        </div>
      </div>
    )
  }

  if (view.step === 'offer') {
    return (
      <div className="sppage">
        <div className="h1">Your Bands are lopsided</div>
        <div className="sub">Duels only happen inside a Band, and one big Band costs far more Duels than a few small ones.</div>
        <SplitChart bars={view.bars} />
        <div className="spcount">
          <b className="strong">Split {label} into Best / Middle / Lowest?</b>
          <div className="small">
            Mark the ones that are your very best and the ones that are only just {label}. Everything you leave alone stays in the
            middle.
          </div>
          <div className="spnums">
            <div>
              <b>{view.duelsNow}</b> Duels now, at most
            </div>
            <div className="eq">→</div>
            <div className="good">
              <b>{view.duelsAfter}</b> after splitting · up to −{view.savings} Duels
            </div>
          </div>
          <div className="small fine">With Tiers ("about the same"), the real savings run about 15–30% lower.</div>
          <div className="row">
            <button className="go" onClick={() => setChoices(takeOffer)}>
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

  const card = (id: number, sub: SubBandIndex, ranked: boolean) => (
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
  const counts = view.columns.map((column) => column.length)

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
        <span className={view.lowSavings ? 'livesave low' : 'livesave'} aria-live="polite">
          up to −{view.savings} Duels
        </span>
        <button className="go sm" onClick={done}>
          Done <span className="kbd">Enter</span>
        </button>
      </div>
      {view.strip && (
        <RankedStrip
          strip={view.strip}
          onMove={(divider, edge) => setChoices((prev) => moveDivider({ state, band, choices: prev }, divider, edge))}
          entries={entries}
          titleLanguage={titleLanguage}
        />
      )}
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
              moveTo(Number(e.dataTransfer.getData('text/plain')), sub)
            }}
          >
            <div className="spcolh">
              <SubPill sub={sub} size={12} />
              <span className="small">{counts[sub]}</span>
            </div>
            <div className="pgrid">
              {view.columns[sub].map(({ id, ranked }) => card(id, sub, ranked))}
              {counts[sub] === 0 && <div className="empty">drop covers here</div>}
            </div>
          </div>
        ))}
      </div>
      {view.warning && (
        <Dialog
          title={`Middle still has ${view.warning.middle} titles`}
          onCancel={() => setChoices(keepSorting)}
          actions={
            <>
              <button className="link" onClick={() => view.warning && onSplit(view.warning.event)}>
                Finish anyway
              </button>
              <button className="go sm" onClick={() => setChoices(keepSorting)}>
                Keep sorting
              </button>
            </>
          }
        >
          <div>
            That only saves up to {view.savings} Duels. Move a few more up to Best or down to Lowest and it saves a lot more: a
            quarter each way is up to −{view.warning.quarterSavings}.
          </div>
        </Dialog>
      )}
      <div className="small fine">
        {label} has up to {view.duelsAsOneBand} Duels to go as one Band.
      </div>
    </div>
  )
}
