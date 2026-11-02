// Top Studios result in the layout picked in #89: the label map (label tiles on a phone) with the open studio's panel
// under it, and the ranked list beside it: the top 3 as podium cards, the rest as rows, the 🌱 watchlist at the end.
import { useEffect, useRef, useState } from 'react'
import type { StudioLabel, TopStudios } from '../loadTopStudios.ts'
import { useMobile } from '../../ui/useMobile.ts'
import { Hearts } from './Bits.tsx'
import { LabelMap, LabelTiles } from './LabelMap.tsx'
import { LABELS } from './labels.ts'
import { openStudio, type StudioCard } from './resultView.ts'
import { StudioPanel } from './StudioPanel.tsx'

const MEDALS = ['🥇', '🥈', '🥉']
const PODIUM = 3

type Props = { topStudios: TopStudios; cards: StudioCard[] }

export function StudiosResult({ topStudios, cards }: Props) {
  const phone = useMobile()
  // The user's #1 is open to start with.
  const [openId, setOpenId] = useState(() => cards[0]?.id ?? -1)
  const [zoom, setZoom] = useState<StudioLabel | null>(null)
  const panel = useRef<HTMLElement>(null)
  const scrollToPanel = useRef(false)
  const opened = openStudio(topStudios, openId) ?? (cards[0] ? openStudio(topStudios, cards[0].id) : null)

  // A new result opens its own #1.
  const [shown, setShown] = useState(topStudios)
  if (shown !== topStudios) {
    setShown(topStudios)
    setOpenId(cards[0]?.id ?? -1)
    setZoom(null)
  }

  useEffect(() => {
    if (!scrollToPanel.current) return
    scrollToPanel.current = false
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [openId])

  /** Opening from the list zooms the phone's map to the studio's tile and brings the panel into view. */
  function openFromList(card: StudioCard) {
    setOpenId(card.id)
    if (phone) setZoom(card.label)
    scrollToPanel.current = true
  }

  if (!cards.length) return <p className="card st-empty">No studio has enough titles to rank yet.</p>

  const lines = topStudios.labelLines
  return (
    <div className="st-lay">
      <div>
        {phone ? (
          <LabelTiles cards={cards} lines={lines} openId={openId} onOpen={setOpenId} zoom={zoom} onZoom={setZoom} />
        ) : (
          <LabelMap cards={cards} lines={lines} openId={openId} onOpen={setOpenId} />
        )}
        <p className="small fine st-maplegend">
          A hit is a title liked well above the user’s average, a flop one well below. A label compares a studio’s share
          of each with the top 20 studios here; a share counts as high only 6 points above theirs.
        </p>
        {opened && <StudioPanel ref={panel} opened={opened} />}
      </div>
      <RankedList cards={cards} gate={topStudios.gate} openId={openId} onOpen={openFromList} />
    </div>
  )
}

function RankedList({ cards, gate, openId, onOpen }: { cards: StudioCard[]; gate: number; openId: number; onOpen: (card: StudioCard) => void }) {
  const ranked = cards.filter((c) => c.rank !== null)
  const watchlist = cards.filter((c) => c.rank === null)
  const podium = ranked.slice(0, PODIUM)
  return (
    <nav className="st-list" aria-label="Ranked studios">
      <ol className="st-podium">
        {podium.map((card, i) => (
          <li key={card.id}>
            <button
              type="button"
              className={card.id === openId ? 'st-tc on' : 'st-tc'}
              aria-pressed={card.id === openId}
              style={{ backgroundImage: `linear-gradient(90deg, #000c, #0004)${card.banner ? `, url("${card.banner}")` : ''}` }}
              onClick={() => onOpen(card)}
            >
              <span className="medal" role="img" aria-label={`#${card.rank}`}>
                {MEDALS[i]}
              </span>
              <span className="nm">
                <b>{card.name}</b>
                <span>
                  <span aria-hidden="true">{LABELS[card.label].icon}</span> {LABELS[card.label].name} · {card.titles} titles
                </span>
              </span>
              <Hearts hearts={card.hearts} score={card.score} big />
            </button>
          </li>
        ))}
      </ol>
      {(ranked.length > PODIUM || watchlist.length > 0) && (
        <div className="card st-rows">
          {ranked.length > PODIUM && (
            <ol start={PODIUM + 1}>
              {ranked.slice(PODIUM).map((card) => (
                <Row key={card.id} card={card} open={card.id === openId} onOpen={onOpen} />
              ))}
            </ol>
          )}
          {watchlist.length > 0 && (
            <>
              <h2 className="st-wlh">
                <b className="up">🌱 Watchlist</b> <span className="fine">· strong, but fewer than {gate} titles</span>
              </h2>
              <ul>
                {watchlist.map((card) => (
                  <Row key={card.id} card={card} open={card.id === openId} onOpen={onOpen} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </nav>
  )
}

function Row({ card, open, onOpen }: { card: StudioCard; open: boolean; onOpen: (card: StudioCard) => void }) {
  return (
    <li>
      <button type="button" className={open ? 'st-it on' : 'st-it'} aria-pressed={open} onClick={() => onOpen(card)}>
        <span className="rk">{card.rank ?? <span aria-label="Watchlist">🌱</span>}</span>
        {card.cover ? (
          <img className="st-av" src={card.cover} alt="" loading="lazy" />
        ) : (
          <span className="st-av" style={{ background: card.coverColor ?? undefined }} />
        )}
        <span className="nm strong">{card.name}</span>
        <span title={LABELS[card.label].name} role="img" aria-label={LABELS[card.label].name}>
          {LABELS[card.label].icon}
        </span>
        <Hearts hearts={card.hearts} score={card.score} />
      </button>
    </li>
  )
}
