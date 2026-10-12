import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ListEntry, ListStatus, MediaType, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import type { AnchorScore } from '../../ranking/engine.ts'
import { OFFERED_STATUSES } from '../../pool/pool.ts'
import { count } from '../meta.ts'
import { statusLabel } from '../start/statusLabel.ts'
import { useMobile } from '../useMobile.ts'
import './picker.css'
import {
  addPicks,
  DEFAULT_PICKER_FILTERS,
  pickerView,
  togglePick,
  wayOut,
  type PickerChange,
  type PickerFacet,
  type PickerFilters,
  type PickerSort,
  type PickerView,
} from './pickerView.ts'

const SORT_LABEL: Record<PickerSort, string> = {
  default: 'No score first, then newest',
  title: 'Title',
  score: 'Score',
  year: 'Release year',
}

/** How a way out of "nothing matches" reads, naming what it undoes. */
function changeLabel(change: PickerChange, filters: PickerFilters): string {
  switch (change) {
    case 'search':
      return `Clear the search “${filters.search.trim()}”`
    case 'statuses':
      return 'Look in every list status'
    case 'years':
      return `Look in all years, not only ${filters.year}`
    case 'genres-tags':
      return 'Clear genres and tags'
  }
}

/** Tags shown as chips before the rest wait for the tag search (#63). */
const TAG_CHIPS = 60

/**
 * The wall draws only the rows of covers on screen, and two more each side (#67): ticking, scrolling and filtering cost
 * the same with 30 titles or 3000. The cards sit in a grid of fixed rows, so where each one goes is known unrendered:
 * a cover's width from the columns (about 118px or more, three across on a phone), its height 2:3, then the text.
 */
const MIN_CARD = 118
const PHONE_COLUMNS = 3
/** Room under a cover for two lines of title and the `year · status` line (see .pk-tt and .pk-mt). */
const CARD_TEXT = 58
const OVERSCAN_ROWS = 2

/** The chosen names with `name` added, or taken out if it was chosen. */
const toggled = (chosen: readonly string[], name: string) => (chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name])

/**
 * The Picker (#64, ADR 0011): the user ticks the titles a Keep My Scale Ranking will score, finding them with the
 * search, filters and sorts (#65). The layout is the one chosen in #63: a wall of covers, the filters in a rail that
 * closes to one line, the summary and Confirm in a dock over the wall; at phone width the filters move to a bottom
 * sheet (#67). Every decision comes from `pickerView`. The picks, filters and search live in this component only:
 * leaving the Picker drops them, and the next visit starts again from `initialPicks` and the default filters (#61).
 */
export function PickerScreen(props: {
  list: readonly ListEntry[]
  scoreFormat: ScoreFormat
  titleLanguage: TitleLanguage
  mediaType: MediaType
  /** The picks it opens with (`startingPicks`). */
  initialPicks: ReadonlySet<number>
  onBack: () => void
  /** Confirm: start the Ranking on these titles, in this order, against this Anchor snapshot. */
  onConfirm: (start: { order: number[]; anchors: AnchorScore[] }) => void
}) {
  const { list, scoreFormat, titleLanguage, mediaType } = props
  const [picked, setPicked] = useState<ReadonlySet<number>>(props.initialPicks)
  const [filters, setFilters] = useState<PickerFilters>(DEFAULT_PICKER_FILTERS)
  // Layout only (#67): the rail open or closed, the genres and tags dialog, the phone's bottom sheet.
  const [railOpen, setRailOpen] = useState(true)
  const [genresOpen, setGenresOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const mobile = useMobile()
  const view = useMemo(
    () => pickerView({ list, scoreFormat, titleLanguage, picked, filters }),
    [list, scoreFormat, titleLanguage, picked, filters],
  )
  const { summary, confirm, dock } = view
  const patch = (more: Partial<PickerFilters>) => setFilters((current) => ({ ...current, ...more }))
  const toggle = useCallback((id: number) => setPicked((current) => togglePick(current, id)), [])
  const toggleStatus = (status: ListStatus) =>
    setFilters((current) => {
      const on = current.statuses.includes(status)
      return { ...current, statuses: OFFERED_STATUSES.filter((s) => (s === status ? !on : current.statuses.includes(s))) }
    })
  const openGenres = () => {
    patch({ tagSearch: '' })
    setGenresOpen(true)
  }
  const chosenFacets = filters.genres.length + filters.tags.length

  const search = (
    <label className="pk-srch">
      <span aria-hidden="true">⌕</span>
      <input type="search" placeholder="Search titles" aria-label="Search titles" value={filters.search} onChange={(e) => patch({ search: e.target.value })} />
    </label>
  )
  const back = (
    <button className="pk-back" onClick={props.onBack}>
      ← Start
    </button>
  )
  const filtersBody = (
    <>
      <div className="pk-lab">List status</div>
      <div className="pk-sts">
        {OFFERED_STATUSES.map((status) => {
          const on = filters.statuses.includes(status)
          return (
            <button key={status} className="pk-ck" role="checkbox" aria-checked={on} onClick={() => toggleStatus(status)}>
              <span className={on ? 'pk-box on' : 'pk-box'} aria-hidden="true">
                ✓
              </span>
              {statusLabel(status, mediaType)}
              <span className="pk-cnt">{view.statusCounts[status] ?? 0}</span>
            </button>
          )
        })}
      </div>
      <div className="pk-lab">Release year</div>
      <select
        className="pk-sel"
        aria-label="Release year"
        value={filters.year ?? ''}
        onChange={(e) => patch({ year: e.target.value === '' ? null : Number(e.target.value) })}
      >
        <option value="">All years</option>
        {view.years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <button className={chosenFacets > 0 ? 'pk-gbtn on' : 'pk-gbtn'} onClick={openGenres}>
        Genres and tags…<span className="pk-v">{chosenFacets > 0 ? `${chosenFacets} chosen` : 'Any'}</span>
      </button>
      <div className="pk-lab">Sort</div>
      <select className="pk-sel" aria-label="Sort" value={filters.sort} onChange={(e) => patch({ sort: e.target.value as PickerSort })}>
        {(Object.keys(SORT_LABEL) as PickerSort[]).map((sort) => (
          <option key={sort} value={sort}>
            Sort: {SORT_LABEL[sort]}
          </option>
        ))}
      </select>
    </>
  )

  let top: ReactNode = null
  if (mobile) {
    top = (
      <div className="pk-ptop">
        {back}
        {search}
        <button className="pk-fb" aria-label={`Filters, ${view.activeFilters} on`} onClick={() => setSheetOpen(true)}>
          ☰<i>{view.activeFilters}</i>
        </button>
      </div>
    )
  } else if (!railOpen) {
    top = (
      <div className="pk-fbar">
        <button className="pk-tog" title="Show filters" aria-label="Show filters" onClick={() => setRailOpen(true)}>
          »
        </button>
        {back}
        {search}
        {filters.statuses.map((status) => (
          <span key={status} className="pk-tok">
            {statusLabel(status, mediaType)}
            <button aria-label={`Hide ${statusLabel(status, mediaType)}`} onClick={() => toggleStatus(status)}>
              ✕
            </button>
          </span>
        ))}
        {filters.year !== null && (
          <span className="pk-tok">
            {filters.year}
            <button aria-label="All years" onClick={() => patch({ year: null })}>
              ✕
            </button>
          </span>
        )}
        {chosenFacets > 0 && (
          <span className="pk-tok g">
            <button className="pk-tok-open" onClick={openGenres}>
              Genres and tags · {chosenFacets}
            </button>
            <button aria-label="Clear genres and tags" onClick={() => patch({ genres: [], tags: [] })}>
              ✕
            </button>
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="pk">
      {!mobile && railOpen && (
        <aside className="pk-rail">
          <div className="pk-rh">
            {back}
            <button className="pk-tog" title="Hide filters" aria-label="Hide filters" onClick={() => setRailOpen(false)}>
              «
            </button>
          </div>
          <h1 className="pk-h1">Choose titles</h1>
          {search}
          {filtersBody}
        </aside>
      )}
      <div className="pk-col">
        {top}
        <div className="pk-bar">
          <span className="pk-shown">
            <b>{view.rows.length}</b> shown
          </span>
          <button className="pk-mini" disabled={view.pickAll.ids.length === 0} onClick={() => setPicked((c) => addPicks(c, view.pickAll.ids))}>
            ✓ Pick all {view.pickAll.shown} shown
          </button>
          <button className="pk-mini" disabled={view.addUnscored.length === 0} onClick={() => setPicked((c) => addPicks(c, view.addUnscored))}>
            ＋ Add {view.addUnscored.length} without a score
          </button>
          <span className="grow" />
          <button
            className={filters.pickedOnly ? 'pk-mini on' : 'pk-mini'}
            aria-pressed={filters.pickedOnly}
            onClick={() => patch({ pickedOnly: !filters.pickedOnly })}
          >
            Picked only ({summary.picked})
          </button>
          <button className="pk-mini" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
            Clear picks
          </button>
        </div>
        <div className="pk-ww">
          {/* A new wall per filter set, so it scrolls back to the top. */}
          <Wall key={JSON.stringify({ ...filters, tagSearch: '' })} rows={view.rows} mediaType={mediaType} mobile={mobile} onToggle={toggle}>
            {view.nothingMatches && (
              <NothingMatches
                ways={view.nothingMatches}
                filters={filters}
                onWay={(change) => setFilters((current) => wayOut(current, change))}
              />
            )}
          </Wall>
          <div className="pk-dock" aria-live="polite">
            {dock.covers.length > 0 && (
              <div className="pk-stack" aria-hidden="true">
                {dock.covers.map((entry) => (
                  <Cover key={entry.mediaId} entry={entry} />
                ))}
              </div>
            )}
            <div className="pk-dtx">
              <b>
                {summary.picked} picked{dock.replacing > 0 ? ` · ${dock.replacing} replace a score` : ''}
              </b>
              <span className={dock.blocked?.warn ? 'pk-why' : undefined}>
                {dock.blocked
                  ? dock.blocked.text
                  : `${count(summary.anchors, 'Anchor')} left on ${count(summary.scores, 'score')} · ≈ ${count(summary.duels, 'Duel')}`}
              </span>
            </div>
            <button
              className="go"
              disabled={!confirm.allowed}
              title={confirm.allowed ? undefined : confirm.reason}
              onClick={() => confirm.allowed && props.onConfirm({ order: confirm.order, anchors: confirm.anchors })}
            >
              Start Duels
            </button>
          </div>
        </div>
      </div>
      {mobile && sheetOpen && (
        <>
          <div className="pk-scrim" onClick={() => setSheetOpen(false)} />
          <div className="pk-sheet" role="dialog" aria-modal="true" aria-label="Filters">
            <div className="pk-grab" />
            {filtersBody}
            <button className="go" onClick={() => setSheetOpen(false)}>
              Show {count(view.rows.length, 'title')}
            </button>
          </div>
        </>
      )}
      {genresOpen && (
        <GenresAndTags
          view={view}
          tagSearch={filters.tagSearch}
          onTagSearch={(tagSearch) => patch({ tagSearch })}
          onFacet={(key, name) => setFilters((current) => ({ ...current, [key]: toggled(current[key], name) }))}
          onClear={() => patch({ genres: [], tags: [], tagSearch: '' })}
          onClose={() => setGenresOpen(false)}
        />
      )}
    </div>
  )
}

/** A cover, or a placeholder in the title's colour when AniList has none. */
function Cover(props: { entry: ListEntry }) {
  const { coverUrl, coverColor } = props.entry
  return coverUrl ? (
    <img className="cv" src={coverUrl} alt="" loading="lazy" decoding="async" draggable={false} style={{ background: coverColor ?? undefined }} />
  ) : (
    <span className="cv ph" style={{ ['--c' as string]: coverColor ?? undefined } as CSSProperties} />
  )
}

/** The wall's size and spacing, read from the page; no card is drawn until they are known. */
type WallBox = { width: number; height: number; top: number; padX: number; padTop: number; gapX: number; gapY: number }

/** The wall of covers, drawing only the rows near the screen; `children` shows when there are no rows. */
function Wall(props: {
  rows: PickerView['rows']
  mediaType: MediaType
  mobile: boolean
  onToggle: (id: number) => void
  children: ReactNode
}) {
  const { rows, mediaType, mobile, onToggle } = props
  const wall = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<WallBox | null>(null)
  useLayoutEffect(() => {
    const el = wall.current
    if (!el) return
    const measure = () => {
      const style = getComputedStyle(el)
      setBox({
        width: el.clientWidth,
        height: el.clientHeight,
        top: el.scrollTop,
        padX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
        padTop: parseFloat(style.paddingTop),
        gapX: parseFloat(style.getPropertyValue('--pk-gap-x')) || 0,
        gapY: parseFloat(style.getPropertyValue('--pk-gap-y')) || 0,
      })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => observer?.disconnect()
  }, [mobile])
  const inner = box ? box.width - box.padX : 0
  const columns = !box ? 1 : mobile ? PHONE_COLUMNS : Math.max(1, Math.floor((inner + box.gapX) / (MIN_CARD + box.gapX)))
  const cardWidth = box ? (inner - box.gapX * (columns - 1)) / columns : 0
  const rowHeight = Math.ceil(cardWidth * 1.5 + CARD_TEXT)
  const step = rowHeight + (box?.gapY ?? 0)
  const rowCount = Math.ceil(rows.length / columns)
  const from = box ? Math.max(0, Math.floor((box.top - box.padTop) / step) - OVERSCAN_ROWS) : 0
  const to = box ? Math.min(rowCount, Math.ceil((box.top - box.padTop + box.height) / step) + OVERSCAN_ROWS) : 0
  const onScroll = (top: number) => setBox((b) => (b && b.top !== top ? { ...b, top } : b))
  return (
    <div className="pk-wall" ref={wall} onScroll={(e) => onScroll(e.currentTarget.scrollTop)}>
      {rows.length > 0 && (
        <div className="pk-rows" style={{ height: Math.max(0, rowCount * step - (box?.gapY ?? 0)) }}>
          <div
            className="pk-grid"
            style={{ top: from * step, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: rowHeight }}
          >
            {rows.slice(from * columns, to * columns).map((row) => (
              <Card
                key={row.entry.mediaId}
                entry={row.entry}
                title={row.title}
                score={row.score}
                year={row.year}
                status={statusLabel(row.status, mediaType)}
                picked={row.picked}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>
      )}
      {props.children}
    </div>
  )
}

/**
 * One title (#63): the cover with its score badge, the title and `year · list status` under it. The whole card is the
 * button. Picked, the cover shrinks inside a blue ring with a tick, and a score it will replace reads `9 → ?`.
 */
const Card = memo(function Card(props: {
  entry: ListEntry
  title: string
  score: string | null
  year: number | null
  status: string
  picked: boolean
  onToggle: (id: number) => void
}) {
  const { entry, score, picked } = props
  const badge = score === null ? 'pk-bs none' : picked ? 'pk-bs re' : 'pk-bs'
  return (
    <button className={picked ? 'pk-cd on' : 'pk-cd'} role="checkbox" aria-checked={picked} onClick={() => props.onToggle(entry.mediaId)}>
      <span className="pk-im">
        <Cover entry={entry} />
        <span className="pk-tk" aria-hidden="true">
          ✓
        </span>
        <span className={badge}>{score === null ? 'no score' : picked ? `${score} → ?` : score}</span>
      </span>
      <span className="pk-tt">{props.title}</span>
      <span className="pk-mt">
        {props.year ?? '—'} · {props.status}
      </span>
    </button>
  )
})

/** Centred in an empty wall: each single change that brings titles back, with how many (#63). */
function NothingMatches(props: { ways: NonNullable<PickerView['nothingMatches']>; filters: PickerFilters; onWay: (change: PickerChange | 'reset') => void }) {
  const { ways, filters } = props
  const why = filters.search.trim()
    ? `Nothing matches “${filters.search.trim()}” with these filters.`
    : filters.pickedOnly
      ? 'Nothing picked shows with these filters.'
      : 'No titles with these filters.'
  return (
    <div className="pk-nomatch">
      <div className="pk-kao">(・_・?)</div>
      <b>No titles match</b>
      <span>{ways.length > 0 ? 'One change brings titles back:' : why}</span>
      {ways.map((way) => (
        <button key={way.change} className="pk-mini" onClick={() => props.onWay(way.change)}>
          {changeLabel(way.change, filters)}
          <b>{count(way.count, 'title')}</b>
        </button>
      ))}
      <button className="link" onClick={() => props.onWay('reset')}>
        Reset search and filters
      </button>
    </div>
  )
}

/** Genres and tags, chosen in one dialog (#63); the content scrolls inside it, the buttons stay at the bottom. */
function GenresAndTags(props: {
  view: PickerView
  tagSearch: string
  onTagSearch: (text: string) => void
  onFacet: (key: 'genres' | 'tags', name: string) => void
  onClear: () => void
  onClose: () => void
}) {
  const { view } = props
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  const chip = (facet: PickerFacet, key: 'genres' | 'tags') => (
    <button
      key={facet.name}
      className={`pk-gc${key === 'tags' ? ' tag' : ''}${facet.chosen ? ' on' : ''}`}
      aria-pressed={facet.chosen}
      disabled={facet.count === 0 && !facet.chosen}
      onClick={() => props.onFacet(key, facet.name)}
    >
      {facet.name}
      <span className="pk-cnt">{facet.count}</span>
    </button>
  )
  return (
    <div className="dscrim" onClick={props.onClose}>
      <div
        ref={box}
        tabIndex={-1}
        className="dlg pk-gt"
        role="dialog"
        aria-modal="true"
        aria-label="Genres and tags"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') props.onClose()
        }}
      >
        <div className="pk-gt-body">
          <div className="h2">Genres and tags</div>
          <span className="small">
            Shows titles that have every genre and tag you choose. {count(view.rows.length, 'title')} match now.
          </span>
          <div className="pk-lab">Genres</div>
          <div className="pk-gchips">{view.genres.map((g) => chip(g, 'genres'))}</div>
          <div className="pk-lab">Tags</div>
          <label className="pk-srch">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder={`Search ${view.tagCount} tags`}
              aria-label="Search tags"
              value={props.tagSearch}
              onChange={(e) => props.onTagSearch(e.target.value)}
            />
          </label>
          <div className="pk-gchips">{view.tags.slice(0, TAG_CHIPS).map((t) => chip(t, 'tags'))}</div>
          {view.tags.length > TAG_CHIPS && <span className="small fine">+ {view.tags.length - TAG_CHIPS} more. Search to find them.</span>}
        </div>
        <div className="pk-gt-btns">
          <button className="go quiet" onClick={props.onClear}>
            Clear all
          </button>
          <button className="go" onClick={props.onClose}>
            Show {count(view.rows.length, 'title')}
          </button>
        </div>
      </div>
    </div>
  )
}
