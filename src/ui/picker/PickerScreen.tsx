import { useMemo, useState } from 'react'
import type { ListEntry, MediaType, ScoreFormat, TitleLanguage } from '../../anilist/types.ts'
import type { AnchorScore } from '../../ranking/engine.ts'
import { OFFERED_STATUSES } from '../../pool/pool.ts'
import { count, pluralWord } from '../meta.ts'
import { statusLabel } from '../start/statusLabel.ts'
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
} from './pickerView.ts'

const SORT_LABEL: Record<PickerSort, string> = {
  default: 'Unscored, then recently completed',
  title: 'Title',
  score: 'Score',
  year: 'Release year',
}

const CHANGE_LABEL: Record<PickerChange, string> = {
  search: 'Clear the search',
  statuses: 'Every list status',
  years: 'All years',
  'genres-tags': 'Clear genres and tags',
}

/** The chosen names with `name` added, or taken out if it was chosen. */
const toggled = (chosen: readonly string[], name: string) => (chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name])

/**
 * The Picker (#64, ADR 0011): the user ticks the titles a Keep My Scale Ranking will score, finding them with the
 * search, filters and sorts (#65). A plain layout; the final look comes with #67. Every decision comes from
 * `pickerView`. The picks, filters and search live in this component only: leaving the Picker drops them, and the next
 * visit starts again from `initialPicks` and the default filters (#61).
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
  const view = useMemo(
    () => pickerView({ list, scoreFormat, titleLanguage, picked, filters }),
    [list, scoreFormat, titleLanguage, picked, filters],
  )
  const { summary, confirm } = view
  const patch = (more: Partial<PickerFilters>) => setFilters((current) => ({ ...current, ...more }))
  const facetChip = (facet: PickerFacet, key: 'genres' | 'tags') => (
    <button
      key={facet.name}
      className={facet.chosen ? 'pk-chip on' : 'pk-chip'}
      aria-pressed={facet.chosen}
      onClick={() => patch({ [key]: toggled(filters[key], facet.name) })}
    >
      {facet.chosen ? '✓ ' : ''}
      {facet.name} <span className="pk-cnt">{facet.count}</span>
    </button>
  )
  const chosenFacets = filters.genres.length + filters.tags.length

  return (
    <div className="pk">
      <header className="pk-top">
        <button className="pk-back" aria-label="Back to Start" onClick={props.onBack}>
          ←
        </button>
        <h1>Choose titles to score</h1>
      </header>
      <div className="pk-summary" aria-live="polite">
        <span>
          <b>{summary.picked}</b> picked · <b>{summary.anchors}</b> {pluralWord(summary.anchors, 'Anchor')} left on{' '}
          <b>{summary.scores}</b> {pluralWord(summary.scores, 'score')} · about <b>{summary.duels}</b> {pluralWord(summary.duels, 'Duel')}
        </span>
        <span className="grow" />
        <button
          className="go sm"
          disabled={!confirm.allowed}
          onClick={() => confirm.allowed && props.onConfirm({ order: confirm.order, anchors: confirm.anchors })}
        >
          Start Duels →
        </button>
      </div>
      {!confirm.allowed && <div className="pk-reason small">{confirm.reason}</div>}
      <div className="pk-hint small fine">
        A picked title is scored again from scratch and is not an Anchor; every other score stays as it is. Planning titles
        are left out.
      </div>
      <div className="pk-filters">
        <div className="pk-line">
          <input
            className="pk-search"
            type="search"
            placeholder="Search titles"
            aria-label="Search titles"
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
          />
          <label className="small">
            Year{' '}
            <select value={filters.year ?? ''} onChange={(e) => patch({ year: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">All years</option>
              {view.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="small">
            Sort{' '}
            <select value={filters.sort} onChange={(e) => patch({ sort: e.target.value as PickerSort })}>
              {(Object.keys(SORT_LABEL) as PickerSort[]).map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABEL[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="pk-line">
          {OFFERED_STATUSES.map((status) => {
            const on = filters.statuses.includes(status)
            return (
              <button
                key={status}
                className={on ? 'pk-chip on' : 'pk-chip'}
                aria-pressed={on}
                onClick={() => patch({ statuses: OFFERED_STATUSES.filter((s) => (s === status ? !on : filters.statuses.includes(s))) })}
              >
                {on ? '✓ ' : ''}
                {statusLabel(status, mediaType)}
              </button>
            )
          })}
        </div>
        <details className="pk-facets">
          <summary className="small">
            Genres and tags{chosenFacets > 0 ? ` (${chosenFacets} chosen)` : ''}
          </summary>
          <div className="pk-lab small">Genres</div>
          <div className="pk-line">{view.genres.map((g) => facetChip(g, 'genres'))}</div>
          <div className="pk-lab small">Tags</div>
          <input
            className="pk-search"
            type="search"
            placeholder="Search tags"
            aria-label="Search tags"
            value={filters.tagSearch}
            onChange={(e) => patch({ tagSearch: e.target.value })}
          />
          <div className="pk-line pk-tags">{view.tags.map((t) => facetChip(t, 'tags'))}</div>
        </details>
        <div className="pk-line">
          <button
            className="go sm"
            disabled={view.addUnscored.length === 0}
            onClick={() => setPicked((current) => addPicks(current, view.addUnscored))}
          >
            Add {view.addUnscored.length} without a score
          </button>
          <button
            className="go sm"
            disabled={view.pickAll.ids.length === 0}
            onClick={() => setPicked((current) => addPicks(current, view.pickAll.ids))}
          >
            Pick all {view.pickAll.shown} shown
          </button>
          <button
            className={filters.pickedOnly ? 'pk-chip on' : 'pk-chip'}
            aria-pressed={filters.pickedOnly}
            onClick={() => patch({ pickedOnly: !filters.pickedOnly })}
          >
            Picked only ({summary.picked})
          </button>
          <button className="link small" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
            Clear
          </button>
          <span className="grow" />
          <span className="small fine">{count(view.rows.length, 'title')} shown</span>
        </div>
      </div>
      {view.nothingMatches && (
        <div className="pk-empty">
          <p>No title matches the search and filters.</p>
          <div className="pk-line">
            {view.nothingMatches.map((way) => (
              <button key={way.change} className="pk-chip" onClick={() => setFilters((current) => wayOut(current, way.change))}>
                {CHANGE_LABEL[way.change]} <span className="pk-cnt">{way.count}</span>
              </button>
            ))}
            <button className="link small" onClick={() => setFilters((current) => wayOut(current, 'reset'))}>
              Reset the search and every filter
            </button>
          </div>
        </div>
      )}
      <ul className="pk-list">
        {view.rows.map((row) => (
          <li key={row.entry.mediaId}>
            <button
              className={row.picked ? 'pk-row on' : 'pk-row'}
              role="checkbox"
              aria-checked={row.picked}
              onClick={() => setPicked((current) => togglePick(current, row.entry.mediaId))}
            >
              <span className="pk-tick" aria-hidden="true">
                {row.picked ? '✓' : ''}
              </span>
              <span className="grow pk-title">{row.title}</span>
              <span className="pk-meta small">{row.year ?? '—'}</span>
              <span className="pk-meta small">{statusLabel(row.status, mediaType)}</span>
              <span className={row.score ? 'pk-score' : 'pk-score none'}>{row.score ?? 'no score'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
