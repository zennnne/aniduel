import type { MediaType } from '../../anilist/types.ts'
import type { StartSign } from '../../catchup/entry.ts'
import { pluralWord } from '../meta.ts'
import './mochi.css'

export type StartCatchUp = {
  /** The selected Media Type, which Catch-up opens on. */
  mediaType: MediaType
  sign: StartSign
  /** Watched titles on its list, or null while it loads. */
  watched: number | null
  /** Fewer than NEAR_EMPTY_BELOW watched: the bubble stays open, the mochi squishes and the sign wiggles. */
  nearEmpty: boolean
  onOpen: () => void
}

/** "shows" or "manga", for `count` of them. */
const titlesWord = (mediaType: MediaType, count: number) => (mediaType === 'MANGA' ? 'manga' : pluralWord(count, 'show'))

/** What the bubble beside the mochi says. */
function bubbleText({ mediaType, sign, watched, nearEmpty }: StartCatchUp): string {
  if (sign.kind === 'failed') return `(｡•́︿•̀｡) ${sign.count} didn’t save… tap me to retry`
  if (nearEmpty && watched !== null) {
    return watched === 0
      ? `(｡•́︿•̀｡) no ${titlesWord(mediaType, 2)} yet? let’s add some!`
      : `(｡•́︿•̀｡) only ${watched} ${titlesWord(mediaType, watched)}? let’s add more!`
  }
  return mediaType === 'MANGA' ? 'Add manga you’ve already read' : 'Add shows you’ve already watched'
}

function SignText({ sign }: { sign: StartSign }) {
  switch (sign.kind) {
    case 'saving':
      return (
        <>
          <i className="fill" style={{ width: `${(sign.saved / Math.max(1, sign.total)) * 100}%` }} />
          <b>
            saving {sign.saved}/{sign.total}
          </b>
        </>
      )
    case 'failed':
      return <b>{sign.count} failed · retry</b>
    case 'catch-up':
      return (
        <>
          + <em>Catch-up</em>
        </>
      )
  }
}

const FACE = { 'catch-up': 'ok', saving: 'ok', failed: 'sad' } as const

/**
 * Catch-up's entry on Start (#52, UI decisions on #37): a pink mochi melted over the Start card's top-right corner,
 * holding a sign in both paws. Tapping it opens Catch-up on the selected Media Type.
 */
export function StartMochi(props: StartCatchUp) {
  const { sign, nearEmpty } = props
  const label =
    sign.kind === 'failed'
      ? `Catch-up: ${sign.count} ${pluralWord(sign.count, 'title')} didn’t save. Open Catch-up to retry.`
      : props.mediaType === 'MANGA'
        ? 'Catch-up: add manga you’ve already read'
        : 'Catch-up: add anime you’ve already watched'
  return (
    <button className={nearEmpty ? 'mochi near-empty' : 'mochi'} data-face={FACE[sign.kind]} aria-label={label} onClick={props.onOpen}>
      <svg className="body" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
        {/* A dome above the corner; the lip melts over the card's top edge (y=58), a drip runs down its right edge. */}
        <path
          d="M24 50 C22 18 50 4 80 4 C112 4 134 22 132 52 C131 76 128 96 124 116 C122 130 106 132 104 118 C102 104 104 90 96 84 L58 84 C46 84 44 92 36 94 C28 95 24 86 24 72 Z"
          className="ink fill-mochi"
        />
        <ellipse cx="62" cy="40" rx="5" ry="3" className="cheek" />
        <ellipse cx="102" cy="40" rx="5" ry="3" className="cheek" />
        <g className="face ok">
          <circle cx="70" cy="30" r="3.4" className="inkf" />
          <circle cx="94" cy="30" r="3.4" className="inkf" />
          <path d="M77 37 q5 4 10 0" className="ink thin" />
        </g>
        <g className="face sad">
          <path d="M65 28 l7 -3 M99 28 l-7 -3" className="ink thin" />
          <circle cx="70" cy="33" r="2.8" className="inkf" />
          <circle cx="94" cy="33" r="2.8" className="inkf" />
          <path d="M77 41 q5 -4 10 0" className="ink thin" />
          <path d="M114 16 q4 6 0 8 q-4 -2 0 -8 z" className="tear" />
        </g>
      </svg>
      <span className={`sign ${sign.kind}`} aria-hidden="true">
        <SignText sign={sign} />
      </span>
      <svg className="paws" width="74" height="14" viewBox="0 0 74 14" aria-hidden="true">
        <ellipse cx="12" cy="7" rx="8" ry="6" className="ink fill-mochi" />
        <ellipse cx="62" cy="7" rx="8" ry="6" className="ink fill-mochi" />
      </svg>
      <span className="bubble" aria-hidden="true">
        {bubbleText(props)}
      </span>
    </button>
  )
}
