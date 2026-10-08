import { useState } from 'react'
import type { CatchUpMedia } from '../../anilist/candidates.ts'
import type { TitleLanguage } from '../../anilist/types.ts'
import {
  DEFAULT_STARTING_YEAR,
  EARLIEST_STARTING_YEAR,
  startingEraLabel,
  type StartingEraAnswer,
} from '../../catchup/startingEra.ts'
import { displayTitle } from '../../pool/pool.ts'
import './startingEra.css'

/** The phone timeline's stops: one landmark cover per era. */
const LANDMARK_YEARS = [1998, 2006, 2012, 2017, 2023]

/** How far from the slider's year a peek cover may be. */
const PEEK_YEARS = 2
const PEEK_COUNT = 5

/** The slider's far end: this year, read once when the app loads. */
const latest = new Date().getFullYear()

/** The most watched of `popular` that started near `year` ("this or before" at the earliest year). */
function near(popular: readonly CatchUpMedia[], year: number): CatchUpMedia[] {
  return popular
    .filter(
      (m) =>
        m.year !== null &&
        (year <= EARLIEST_STARTING_YEAR ? m.year <= year + PEEK_YEARS : Math.abs(m.year - year) <= PEEK_YEARS),
    )
    .sort((a, b) => b.watched - a.watched || a.id - b.id)
}

function Cover(props: { media: CatchUpMedia; titleLanguage: TitleLanguage }) {
  const name = displayTitle(props.media.title, props.titleLanguage)
  return (
    <span className="cu-era-cover" style={{ backgroundColor: props.media.coverColor ?? undefined }} title={name}>
      {props.media.coverUrl ? <img src={props.media.coverUrl} alt={name} loading="lazy" /> : <span>{name}</span>}
    </span>
  )
}

/** The mochi melting over the question card's corner. */
function DrapeMochi() {
  return (
    <svg className="cu-era-drape" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
      <path
        d="M24 50 C22 18 50 4 80 4 C112 4 134 22 132 52 C131 76 128 96 124 116 C122 130 106 132 104 118 C102 104 104 90 96 84 L58 84 C46 84 44 92 36 94 C28 95 24 86 24 72 Z"
        className="ink"
        style={{ fill: 'var(--mochi)' }}
      />
      <ellipse cx="62" cy="40" rx="5" ry="3" fill="var(--mochi-cheek)" opacity=".7" />
      <ellipse cx="102" cy="40" rx="5" ry="3" fill="var(--mochi-cheek)" opacity=".7" />
      <circle cx="70" cy="30" r="4" className="inkf" />
      <circle cx="94" cy="30" r="4" className="inkf" />
      <circle cx="71.5" cy="28.5" r="1.5" fill="#fff" />
      <circle cx="95.5" cy="28.5" r="1.5" fill="#fff" />
      <path d="M77 37 q2.5 3 5 0 q2.5 3 5 0" className="ink" style={{ strokeWidth: 2 }} />
      <ellipse cx="48" cy="86" rx="8" ry="6" className="ink" style={{ fill: 'var(--mochi)' }} />
      <ellipse cx="88" cy="86" rx="8" ry="6" className="ink" style={{ fill: 'var(--mochi)' }} />
    </svg>
  )
}

/**
 * The Starting era question (#51, UI decisions on #37): a year slider with popular covers from around then on desktop,
 * a timeline of landmark covers on phones. `popular` is all-time favourites, null while loading.
 */
export function StartingEraQuestion(props: {
  popular: CatchUpMedia[] | null
  /** The saved answer when changing it from the era chip. */
  answer: StartingEraAnswer | undefined
  titleLanguage: TitleLanguage
  onAnswer: (answer: StartingEraAnswer) => void
}) {
  const [year, setYear] = useState(() => Math.min(latest, props.answer ?? DEFAULT_STARTING_YEAR))
  const popular = props.popular ?? []
  const peek = near(popular, year).slice(0, PEEK_COUNT)
  const used = new Set<number>()
  const landmarks = LANDMARK_YEARS.filter((y) => y <= latest).map((y) => {
    const media = near(popular, y).find((m) => !used.has(m.id)) ?? null
    if (media) used.add(media.id)
    return { year: y, media }
  })
  const skip = (
    <button className="link small" onClick={() => props.onAnswer(null)}>
      Skip — show all-time favourites
    </button>
  )

  return (
    <div className="cu-era">
      <div className="cu-era-card cu-era-desktop">
        <DrapeMochi />
        <h2>Roughly when did you start watching anime?</h2>
        <div className="cu-era-year" aria-live="polite">
          {year <= EARLIEST_STARTING_YEAR ? `${EARLIEST_STARTING_YEAR} or earlier` : year}
        </div>
        <input
          type="range"
          min={EARLIEST_STARTING_YEAR}
          max={latest}
          value={year}
          aria-label="Year you started watching anime"
          aria-valuetext={startingEraLabel(year)}
          onChange={(e) => setYear(Number(e.target.value))}
        />
        <div className="small">shows from around then:</div>
        <div className="cu-era-peek">
          {props.popular === null ? (
            <span className="small fine">Loading…</span>
          ) : (
            peek.map((m) => <Cover key={m.id} media={m} titleLanguage={props.titleLanguage} />)
          )}
        </div>
        <button className="go" onClick={() => props.onAnswer(year)}>
          That’s about right →
        </button>
      </div>

      <div className="cu-era-phone">
        <h2>Which of these is closest to when you started?</h2>
        <p className="small">Pick the one that feels like “my early days” — you don’t need to have seen it.</p>
        <div className="cu-era-tl">
          {landmarks.map(({ year: y, media }) => (
            <button key={y} onClick={() => props.onAnswer(y)} aria-label={`Around ${y}`}>
              {media ? (
                <Cover media={media} titleLanguage={props.titleLanguage} />
              ) : (
                <span className="cu-era-cover" />
              )}
              <b>{y}</b>
            </button>
          ))}
        </div>
      </div>
      {skip}
    </div>
  )
}

/** The Starting era chip beside "Batch N": "around 2012 ✎" reopens the question. */
export function StartingEraChip(props: { label: string; onChange: () => void }) {
  return (
    <button className="cu-erachip" title="Change when you started watching" onClick={props.onChange}>
      {props.label} ✎
    </button>
  )
}
