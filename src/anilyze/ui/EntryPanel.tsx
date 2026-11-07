// The open studio's or Director's panel (#89): its header, the mochi's one-sentence summary, the 3 titles that lifted it most and the 3
// that held it back most (against the user's own average), and "All N titles" folding out a swarm of every title.
import { forwardRef, useMemo, useState } from 'react'
import type { ToolWords } from '../tool.ts'
import { Hearts, LabelPill, Mochi } from './Bits.tsx'
import type { Picture } from './Picture.tsx'
import { useWidth } from './useWidth.ts'
import { pushText, type CountedTitle, type OpenEntry } from './resultView.ts'
import { swarm } from './swarm.ts'

const percent = (rate: number) => `${Math.round(rate * 100)}%`

type Props = { opened: OpenEntry; words: ToolWords; Picture: Picture }

export const EntryPanel = forwardRef<HTMLElement, Props>(function EntryPanel({ opened, words, Picture }, ref) {
  const { card, summary, lifted, heldBack, titles } = opened
  const [allOpen, setAllOpen] = useState(false)
  return (
    <section className="st-det card" ref={ref} aria-labelledby="st-det-name">
      <div className="st-banner" style={{ backgroundImage: card.banner ? `url("${card.banner}")` : undefined }} />
      <div className="st-dh">
        <Picture card={card} place="panel" />
        <div className="st-dh-name">
          <div className="small fine">
            {card.rank === null ? '🌱 Watchlist' : `#${card.rank}`} · {card.votes} titles · {percent(card.hitRate)} hits ·{' '}
            {percent(card.flopRate)} flops
          </div>
          <h2 id="st-det-name">{card.name}</h2>
          {card.page && (
            <a className="small st-page" href={card.page} target="_blank" rel="noreferrer">
              On AniList ↗
            </a>
          )}
        </div>
        <div className="st-dh-side">
          <LabelPill label={card.label} />
          <Hearts hearts={card.hearts} score={card.score} scoreName={words.score} big />
        </div>
      </div>
      <div className="st-db">
        <div className="st-say">
          <Mochi size={52} />
          <p>
            {card.name} is {card.rank === null ? <>on your 🌱 watchlist</> : <>your <b>#{card.rank}</b></>}.{' '}
            <b>{summary.beatUsual}</b> of its {summary.of} titles beat your usual
            {summary.best && (
              <>
                , led by <b>{summary.best}</b>
              </>
            )}
            {summary.worst && (
              <>
                ; <b>{summary.worst}</b> let you down the most
              </>
            )}
            .
          </p>
        </div>
        <div className="st-two">
          <TitleRow heading="▲ Lifted it most" up titles={lifted} />
          <TitleRow heading="▼ Held it back most" up={false} titles={heldBack} />
        </div>
        <details className="st-all" open={allOpen} onToggle={(e) => setAllOpen(e.currentTarget.open)}>
          <summary>All {titles.length} titles</summary>
          {allOpen && <Swarm opened={opened} />}
        </details>
      </div>
    </section>
  )
})

function TitleRow({ heading, up, titles }: { heading: string; up: boolean; titles: CountedTitle[] }) {
  return (
    <div>
      <h3 className={up ? 'st-sec up' : 'st-sec down'}>{heading}</h3>
      {titles.length ? (
        <ul className="st-covers">
          {titles.map((t) => (
            <li key={t.mediaId} className={up ? 'st-cv' : 'st-cv dn'}>
              <a href={t.siteUrl} target="_blank" rel="noreferrer">
                {t.cover ? <img src={t.cover} alt="" loading="lazy" /> : <span className="st-noimg" style={{ background: t.coverColor ?? undefined }} />}
                <span className={up ? 'pb up' : 'pb down'} aria-hidden="true">
                  {up ? '▲' : '▼'}
                </span>
                <span className="ct">{t.name}</span>
              </a>
              <span className="cs">{t.how}</span>
              <span className="cs">{pushText(t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small fine">{up ? 'None beat your usual.' : 'None fell below your usual.'}</p>
      )}
    </div>
  )
}

/** Hover or focus a cover for its name, how it was marked and how it pushed the score. */
const tip = (t: CountedTitle) => `${t.name} · ${t.how} · ${pushText(t)}`

function Swarm({ opened }: { opened: OpenEntry }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const box = width < 480 ? 240 : 220
  const scored = useMemo(() => opened.titles.filter((t): t is CountedTitle & { score: number } => t.score !== null), [opened])
  const unscored = opened.titles.filter((t) => t.score === null)
  const laid = useMemo(() => (width && scored.length ? swarm(scored, opened.usualScore, { width, height: box }) : null), [scored, opened.usualScore, width, box])
  const height = laid?.height ?? box
  return (
    <div className="st-swarmwrap">
      {scored.length > 0 && (
        <div className="st-swarm" ref={ref} style={{ height: height + 26 }}>
          <div className="grad" style={{ height }} />
          {laid && (
            <>
              <div className="avg" style={{ left: laid.at(opened.usualScore), height }}>
                <Mochi size={34} className="mm" />
                <span className="t">your usual {opened.usualScore.toFixed(1)}</span>
              </div>
              <ul>
                {laid.beads.map(({ item, x, y, r }) => (
                  <li key={item.mediaId} style={{ left: x, top: y, width: r * 2, height: r * 2 }}>
                    <Bead title={item} />
                  </li>
                ))}
              </ul>
              {laid.ticks.map((v) => (
                <span key={v} className="tk" style={{ left: laid.at(v), top: height + 4 }} aria-hidden="true">
                  {v}
                </span>
              ))}
            </>
          )}
        </div>
      )}
      <p className="small fine">Bigger = weighs more (longer show, rewatched). Hover or focus a cover for its name.</p>
      {unscored.length > 0 && (
        <div className="st-unsc">
          <span className="small fine">No score, still counted:</span>
          <ul>
            {unscored.map((t) => (
              <li key={t.mediaId}>
                <Bead title={t} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Bead({ title }: { title: CountedTitle }) {
  return (
    <a
      className={`st-bead${title.dropped ? ' drop' : ''}${title.favourite ? ' fav' : ''}`}
      href={title.siteUrl}
      target="_blank"
      rel="noreferrer"
      data-tip={tip(title)}
      aria-label={tip(title)}
    >
      {title.cover ? (
        <img src={title.cover} alt="" loading="lazy" />
      ) : (
        <span className="st-noimg" style={{ background: title.coverColor ?? undefined }} />
      )}
    </a>
  )
}
