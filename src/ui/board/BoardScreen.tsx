import { useEffect, useEffectEvent, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, SUB_BANDS, type BandIndex, type BoardTitle, type RankingState, type SubBandIndex } from '../../ranking/engine.ts'
import { BAND_UI, SUB_BAND_UI, subBandForKey } from '../bands.ts'
import { Dialog } from '../Dialog.tsx'
import { UNDO_ICON } from '../icons.tsx'
import { Kao } from '../Kao.tsx'
import { SubBandButtons } from '../SubBandChoice.tsx'
import { titleName } from '../meta.ts'
import './board.css'

/** A mouse drag starts after this many pixels; a touch drag after holding this long (moving earlier scrolls). */
const MOUSE_SLOP = 5
const TOUCH_HOLD_MS = 300
const TOUCH_SLOP = 8
/** Distance from a list's top or bottom edge where a drag scrolls it, and how far per frame. */
const EDGE = 50
const EDGE_STEP = 14

const MOBILE = '(max-width: 720px)'

function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(MOBILE).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(MOBILE)
    if (!query) return
    const onChange = () => setMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

type Card = BoardTitle & { name: string; entry: ListEntry | undefined }

/** `name` with the first match of `query` highlighted. */
function highlight(name: string, query: string): ReactNode {
  const at = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at < 0) return name
  return (
    <>
      {name.slice(0, at)}
      <mark>{name.slice(at, at + query.length)}</mark>
      {name.slice(at + query.length)}
    </>
  )
}

/** A title's small cover, or a placeholder in its cover colour. Never natively draggable: the Board drags itself. */
function Cover({ entry }: { entry: ListEntry | undefined }) {
  return entry?.coverUrl ? (
    <img className="cv" src={entry.coverUrl} alt="" draggable={false} />
  ) : (
    <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />
  )
}

/** The pointer gesture on a card: pending until it becomes a drag (mouse moved, or touch held). */
type Gesture = { id: number; x: number; y: number; touch: boolean; timer?: number; dragging: boolean }

/**
 * The Board: every title that has a Band, in five columns with Loved leftmost (on
 * mobile one column plus a rail of Band blocks). Drag a title to another Band; a split Band asks for the Sub-band
 * (drop zones on desktop, a Q / W / E dialog otherwise). Search hides titles whose name doesn't match.
 */
export function BoardScreen(props: {
  state: RankingState
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  heading: string
  hint: string
  /** The main button on the right of the toolbar (e.g. "← Back to Rough Sort · 12 left"). */
  mainLabel: ReactNode
  onMain: () => void
  onMove: (id: number, band: BandIndex, sub?: SubBandIndex) => void
  onUndo: () => void
}) {
  const { state, entries, titleLanguage, heading, hint, mainLabel, onMain, onMove, onUndo } = props
  const mobile = useMobile()
  const [query, setQuery] = useState('')
  const [shownBand, setShownBand] = useState<BandIndex>(0)
  const [subPick, setSubPick] = useState<{ id: number; band: BandIndex } | null>(null)
  // The dragged title and where the drag started (the ghost follows the pointer from there, outside React).
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null)
  const dragging = drag?.id ?? null
  const gesture = useRef<Gesture | null>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const page = useRef<HTMLDivElement>(null)
  const over = useRef<HTMLElement | null>(null)
  const pointer = useRef({ x: 0, y: 0 })

  const q = query.trim()
  const columns = BANDS.map((band) => {
    const all: Card[] = state.board.bands[band].titles.map((t) => {
      const entry = entries.get(t.id)
      return { ...t, entry, name: titleName(entry, t.id, titleLanguage) }
    })
    // Titles put in the Band by the same event share `at`: list those by name.
    all.sort((x, y) => y.at - x.at || x.name.localeCompare(y.name))
    const shown = q ? all.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : all
    return { band, all, shown, split: Boolean(state.bands[band].subBands) }
  })
  const found = columns.reduce((sum, c) => sum + c.shown.length, 0)
  const cardOf = (id: number) => columns.flatMap((c) => c.all).find((c) => c.id === id)
  const bandOf = (id: number) => columns.find((c) => c.all.some((t) => t.id === id))?.band

  /**
   * A drop on a split Band without a Sub-band (a mobile rail block, or a desktop column outside the zones) asks
   * which Sub-band, its own Band included, so a title can move to another Sub-band of it. The same Band and
   * Sub-band, or the same unsplit Band, does nothing.
   */
  function drop(id: number, band: BandIndex, sub: SubBandIndex | undefined) {
    const card = cardOf(id)
    if (!card) return
    const split = Boolean(state.bands[band].subBands)
    if (split && sub === undefined) {
      setSubPick({ id, band })
      return
    }
    if (bandOf(id) === band && (!split || sub === card.sub)) return
    onMove(id, band, sub)
  }

  function setOver(el: HTMLElement | null) {
    if (el === over.current) return
    over.current?.classList.remove('over')
    over.current = el
    el?.classList.add('over')
  }

  function place(x: number, y: number) {
    pointer.current = { x, y }
    if (ghost.current) {
      ghost.current.style.left = `${x}px`
      ghost.current.style.top = `${y}px`
    }
    const target = document.elementFromPoint(x, y)
    setOver(target instanceof Element ? target.closest<HTMLElement>('[data-drop]') : null)
  }

  function begin() {
    const g = gesture.current
    if (!g || g.dragging) return
    g.dragging = true
    navigator.vibrate?.(15)
    setDrag({ id: g.id, ...pointer.current })
  }

  function end(commit: boolean) {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    window.clearTimeout(g.timer)
    if (!g.dragging) return
    setDrag(null)
    const target = over.current
    setOver(null)
    if (!commit || !target) return
    const band = Number(target.dataset.drop) as BandIndex
    const sub = target.dataset.sub === undefined ? undefined : (Number(target.dataset.sub) as SubBandIndex)
    drop(g.id, band, sub)
  }

  function onCardDown(e: ReactPointerEvent, id: number) {
    if (e.button > 0 || subPick) return
    const touch = e.pointerType !== 'mouse'
    const g: Gesture = { id, x: e.clientX, y: e.clientY, touch, dragging: false }
    pointer.current = { x: e.clientX, y: e.clientY }
    if (touch) g.timer = window.setTimeout(begin, TOUCH_HOLD_MS)
    gesture.current = g
  }

  const onMoveEvent = useEffectEvent((e: PointerEvent) => {
    const g = gesture.current
    if (!g) return
    if (!g.dragging) {
      const distance = Math.hypot(e.clientX - g.x, e.clientY - g.y)
      pointer.current = { x: e.clientX, y: e.clientY }
      if (!g.touch && distance > MOUSE_SLOP) begin()
      else if (g.touch && distance > TOUCH_SLOP) end(false) // the finger moved first: it is a scroll
      return
    }
    e.preventDefault()
    place(e.clientX, e.clientY)
  })
  const onUpEvent = useEffectEvent(() => end(true))
  const onCancelEvent = useEffectEvent(() => {
    // A touch drag keeps going even if the browser gives up the pointer; only a pending one is dropped.
    if (!gesture.current?.dragging) end(false)
  })

  useEffect(() => {
    const move = (e: PointerEvent) => onMoveEvent(e)
    const up = () => onUpEvent()
    const cancel = () => onCancelEvent()
    const touchMove = (e: TouchEvent) => gesture.current?.dragging && e.preventDefault()
    const menu = (e: Event) => gesture.current && e.preventDefault()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('contextmenu', menu)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('contextmenu', menu)
    }
  }, [])

  // While dragging: place the ghost, and scroll a list when the pointer is near its top or bottom edge.
  const frame = useEffectEvent(() => {
    const { x, y } = pointer.current
    for (const list of page.current?.querySelectorAll<HTMLElement>('[data-scroll]') ?? []) {
      const r = list.getBoundingClientRect()
      if (x < r.left || x > r.right || y < r.top - 40 || y > r.bottom + 40) continue
      if (y < r.top + EDGE) list.scrollTop -= EDGE_STEP
      else if (y > r.bottom - EDGE) list.scrollTop += EDGE_STEP
    }
    place(x, y)
  })
  useEffect(() => {
    if (dragging === null) return
    let raf = 0
    const loop = () => {
      frame()
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [dragging])

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (subPick || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (state.canUndo) onUndo()
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const columnCount = (c: (typeof columns)[number]) => (q ? `${c.shown.length}/${c.all.length}` : String(c.all.length))
  const card = (c: Card, split: boolean) => {
    const mark = split && c.sub !== undefined ? SUB_BAND_UI[c.sub] : null
    return (
      <div
        key={c.id}
        className={['bdcard', mark && 'mk', dragging === c.id && 'lifted'].filter(Boolean).join(' ')}
        style={mark ? { ['--s' as string]: mark.colour } : undefined}
        onPointerDown={(e) => onCardDown(e, c.id)}
        title={c.name}
      >
        <Cover entry={c.entry} />
        <div className="nm">{highlight(c.name, q)}</div>
        {mark && <span className="sb">{mark.label}</span>}
      </div>
    )
  }
  const list = (c: (typeof columns)[number]) => (
    <div className="bdlist" data-scroll>
      {c.shown.length > 0 ? (
        c.shown.map((t) => card(t, c.split))
      ) : (
        <div className="bdempty">{q ? 'No match · drop here still works' : 'Empty'}</div>
      )}
    </div>
  )
  const head = (c: (typeof columns)[number]) => (
    <div className="bdch">
      <Kao band={c.band} size={12} />
      <span className="grow">
        {BAND_UI[c.band].label}
        {c.split && <span className="small fine"> · 3 Sub-bands</span>}
      </span>
      <span className="n">{columnCount(c)}</span>
    </div>
  )

  const dragged = dragging === null ? undefined : cardOf(dragging)
  const picking = subPick ? cardOf(subPick.id) : undefined
  const shown = columns[shownBand]

  return (
    <div className={dragging === null ? 'bd' : 'bd dragging'} ref={page}>
      <div className="bdhd">
        <div>
          <div className="ttl">{heading}</div>
          <div className="small hide-m">{hint}</div>
        </div>
        <div className="grow" />
        <label className="bdsearch">
          <span aria-hidden>⌕</span>
          <input
            value={query}
            placeholder="Search titles"
            aria-label="Search titles"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
          {q && <span className="small fine">{found} found</span>}
          {query && (
            <button className="small" onClick={() => setQuery('')} aria-label="Clear search">
              ✕
            </button>
          )}
        </label>
        <button className="ghostbtn" onClick={onUndo} disabled={!state.canUndo}>
          {UNDO_ICON} Undo
        </button>
        <button className="go sm" onClick={onMain}>
          {mainLabel}
        </button>
      </div>
      {q && found === 0 && (
        <div className="bdnomatch">
          No title matches “{q}”. Search looks at names in your title language.{' '}
          <button className="link" onClick={() => setQuery('')}>
            Clear search
          </button>
        </div>
      )}
      {!mobile ? (
        <div className="bdcols">
          {columns.map((c) => (
            <div key={c.band} className="bdcol" data-drop={c.band} style={{ ['--c' as string]: BAND_UI[c.band].colour }}>
              {head(c)}
              {c.split && (
                <div className="bdzones">
                  {SUB_BANDS.map((sub) => (
                    <div key={sub} data-drop={c.band} data-sub={sub} style={{ ['--s' as string]: SUB_BAND_UI[sub].colour }}>
                      {SUB_BAND_UI[sub].label} <span className="kbd">{SUB_BAND_UI[sub].key}</span>
                    </div>
                  ))}
                </div>
              )}
              {list(c)}
            </div>
          ))}
        </div>
      ) : (
        <div className="bdbody">
          <div className="bdcol" data-drop={shown.band} style={{ ['--c' as string]: BAND_UI[shown.band].colour }}>
            {head(shown)}
            {list(shown)}
          </div>
          <div className="bdrail" role="group" aria-label="Bands">
            {columns.map((c) => (
              <button
                key={c.band}
                className={c.band === shownBand ? 'sel' : undefined}
                data-drop={c.band}
                style={{ ['--c' as string]: BAND_UI[c.band].colour }}
                onClick={() => setShownBand(c.band)}
                aria-label={`${BAND_UI[c.band].label}: ${columnCount(c)}`}
                aria-pressed={c.band === shownBand}
              >
                <Kao band={c.band} size={8} />
                <span>{columnCount(c)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {dragged && (
        <div className="bdghost" ref={ghost} style={{ left: drag?.x, top: drag?.y }}>
          <Cover entry={dragged.entry} />
        </div>
      )}
      {subPick && picking && (
        <SubBandPicker
          band={subPick.band}
          current={bandOf(subPick.id) === subPick.band ? picking.sub : undefined}
          name={picking.name}
          onPick={(sub) => {
            setSubPick(null)
            drop(subPick.id, subPick.band, sub)
          }}
          onCancel={() => setSubPick(null)}
        />
      )}
    </div>
  )
}

/**
 * "Loved has 3 Sub-bands. Where does “X” go?": the Move sheet's Sub-band choice (Q / W / E), Esc cancels. The
 * Sub-band the title is in now (`current`, when it is already in this Band) is disabled.
 */
function SubBandPicker(props: {
  band: BandIndex
  current: SubBandIndex | undefined
  name: string
  onPick: (sub: SubBandIndex) => void
  onCancel: () => void
}) {
  const { band, current, name, onPick, onCancel } = props
  // Capture phase: the Dialog keeps key presses to itself, so listen before they reach it.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const sub = subBandForKey(e)
    if (sub === undefined) return
    e.preventDefault()
    e.stopPropagation()
    if (sub !== current) onPick(sub)
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])
  return (
    <Dialog title={`${BAND_UI[band].label} has 3 Sub-bands. Where does “${name}” go?`} onCancel={onCancel} actions={null}>
      <div className="bdsubs" role="group" aria-label="Sub-band">
        <SubBandButtons band={band} current={current} keys autoFocus onPick={onPick} />
      </div>
      <div className="small fine">Esc to cancel</div>
    </Dialog>
  )
}
