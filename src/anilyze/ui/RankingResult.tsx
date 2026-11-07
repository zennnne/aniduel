// An AniLyze tool's result in the layout picked in #89 for Top Studios: the label map (label tiles on a phone) with the
// open one's panel under it, and the ranked list beside it: the top 3 as podium cards, the rest as rows, the 🌱
// watchlist at the end. In the tool's words, with its picture for each card.
import { useEffect, useRef, useState } from 'react'
import { useMobile } from '../../ui/useMobile.ts'
import type { Label, Ranking } from '../scoring.ts'
import type { Tool, ToolWords } from '../tool.ts'
import { Hearts } from './Bits.tsx'
import { EntryPanel } from './EntryPanel.tsx'
import { LabelMap, LabelTiles } from './LabelMap.tsx'
import { LABELS } from './labels.ts'
import type { Picture } from './Picture.tsx'
import { openEntry, type CardPicture, type RankCard } from './resultView.ts'

const MEDALS = ['🥇', '🥈', '🥉']
const PODIUM = 3

type Props = {
  ranking: Ranking
  cards: RankCard[]
  tool: Tool
  /** Draws each card's picture. */
  Picture: Picture
  /** The cards' picture data, as `cards` were made with (the cover of the title that lifts it most by default). */
  cardPicture?: CardPicture
}

export function RankingResult({ ranking, cards, tool, Picture, cardPicture }: Props) {
  const { words } = tool
  const phone = useMobile()
  // The user's #1 is open to start with.
  const [openId, setOpenId] = useState(() => cards[0]?.id ?? -1)
  const [zoom, setZoom] = useState<Label | null>(null)
  const panel = useRef<HTMLElement>(null)
  const scrollToPanel = useRef(false)
  const opened = openEntry(ranking, openId, cardPicture) ?? (cards[0] ? openEntry(ranking, cards[0].id, cardPicture) : null)

  // A new result opens its own #1.
  const [shown, setShown] = useState(ranking)
  if (shown !== ranking) {
    setShown(ranking)
    setOpenId(cards[0]?.id ?? -1)
    setZoom(null)
  }

  useEffect(() => {
    if (!scrollToPanel.current) return
    scrollToPanel.current = false
    panel.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [openId])

  /** Opening from the list zooms the phone's map to the card's tile and brings the panel into view. */
  function openFromList(card: RankCard) {
    setOpenId(card.id)
    if (phone) setZoom(card.label)
    scrollToPanel.current = true
  }

  if (!cards.length) return <p className="card st-empty">No {words.one} has enough titles to rank yet.</p>

  const lines = ranking.labelLines
  return (
    <div className="st-lay">
      <div>
        {phone ? (
          <LabelTiles words={words} Picture={Picture} cards={cards} lines={lines} openId={openId} onOpen={setOpenId} zoom={zoom} onZoom={setZoom} />
        ) : (
          <LabelMap words={words} Picture={Picture} cards={cards} lines={lines} openId={openId} onOpen={setOpenId} />
        )}
        <p className="small fine st-maplegend">
          A hit is a title liked well above the user’s average, a flop one well below. A label compares a {words.one}’s share
          of each with the top {tool.scoring.labels.pool} {words.many} here; a share counts as high only{' '}
          {Math.round(tool.scoring.labels.margin * 100)} points above theirs.
        </p>
        {opened && <EntryPanel ref={panel} opened={opened} words={words} Picture={Picture} />}
      </div>
      <RankedList words={words} Picture={Picture} cards={cards} gate={ranking.gate} openId={openId} onOpen={openFromList} />
    </div>
  )
}

type ListProps = { words: ToolWords; Picture: Picture; openId: number; onOpen: (card: RankCard) => void }

function RankedList({ words, Picture, cards, gate, openId, onOpen }: ListProps & { cards: RankCard[]; gate: number }) {
  const ranked = cards.filter((c) => c.rank !== null)
  const watchlist = cards.filter((c) => c.rank === null)
  const podium = ranked.slice(0, PODIUM)
  return (
    <nav className="st-list" aria-label={`Ranked ${words.many}`}>
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
                  <span aria-hidden="true">{LABELS[card.label].icon}</span> {LABELS[card.label].name} · {card.votes} titles
                </span>
              </span>
              <Hearts hearts={card.hearts} score={card.score} scoreName={words.score} big />
            </button>
          </li>
        ))}
      </ol>
      {(ranked.length > PODIUM || watchlist.length > 0) && (
        <div className="card st-rows">
          {ranked.length > PODIUM && (
            <ol start={PODIUM + 1}>
              {ranked.slice(PODIUM).map((card) => (
                <Row key={card.id} words={words} Picture={Picture} card={card} open={card.id === openId} onOpen={onOpen} />
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
                  <Row key={card.id} words={words} Picture={Picture} card={card} open={card.id === openId} onOpen={onOpen} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </nav>
  )
}

function Row({ words, Picture, card, open, onOpen }: Omit<ListProps, 'openId'> & { card: RankCard; open: boolean }) {
  return (
    <li>
      <button type="button" className={open ? 'st-it on' : 'st-it'} aria-pressed={open} onClick={() => onOpen(card)}>
        <span className="rk">{card.rank ?? <span aria-label="Watchlist">🌱</span>}</span>
        <Picture card={card} place="row" />
        <span className="nm strong">{card.name}</span>
        <span title={LABELS[card.label].name} role="img" aria-label={LABELS[card.label].name}>
          {LABELS[card.label].icon}
        </span>
        <Hearts hearts={card.hearts} score={card.score} scoreName={words.score} />
      </button>
    </li>
  )
}
