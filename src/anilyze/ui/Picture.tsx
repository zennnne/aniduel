// A ranked card's picture wherever the result shows one: a studio's cover (CoverPicture) or, on Top Directors, a
// Director's face. Each tool passes its own to the shared result components.
import type { ReactNode } from 'react'
import type { RankCard } from './resultView.ts'

/**
 * Where it is drawn: a ranked row's avatar, the open panel's big avatar, a label map bubble (inside the bubble, which
 * already shows `coverColor`), or one of a phone label tile's little stack.
 */
export type PicturePlace = 'row' | 'panel' | 'bubble' | 'tile'

export type PictureProps = { card: RankCard; place: PicturePlace }

/** A tool's picture: what to draw for `card` at `place`. */
export type Picture = (props: PictureProps) => ReactNode

/** "NY" for Naoko Yamada: the first letters of the first and last word. */
function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0]?.[0] ?? '?')
}

/**
 * The card's own face, cropped round (#99's P1): a Director's picture. Someone AniList has no picture of shows their
 * initials on the mochi pink.
 */
export function FacePicture({ card, place }: PictureProps): ReactNode {
  const initials = initialsOf(card.name)
  switch (place) {
    case 'row':
      return card.cover ? <img className="st-av" src={card.cover} alt="" loading="lazy" /> : <span className="st-av st-noface">{initials}</span>
    case 'panel':
      return card.cover ? <img className="st-av big" src={card.cover} alt="" /> : <span className="st-av big st-noface">{initials}</span>
    case 'bubble':
      return card.cover ? <img src={card.cover} alt="" loading="lazy" /> : <span className="st-noface">{initials}</span>
    case 'tile':
      return card.cover ? <img src={card.cover} alt="" /> : <i className="st-noface">{initials}</i>
  }
}

/** The card's cover as is, its main colour while it loads or when there is none: a studio's picture. */
export function CoverPicture({ card, place }: PictureProps): ReactNode {
  const background = { background: card.coverColor ?? undefined }
  switch (place) {
    case 'row':
      return card.cover ? <img className="st-av" src={card.cover} alt="" loading="lazy" /> : <span className="st-av" style={background} />
    case 'panel':
      return card.cover ? <img className="st-av big" src={card.cover} alt="" /> : <span className="st-av big" style={background} />
    case 'bubble':
      return card.cover && <img src={card.cover} alt="" loading="lazy" />
    case 'tile':
      return card.cover ? <img src={card.cover} alt="" /> : <i style={background} />
  }
}
