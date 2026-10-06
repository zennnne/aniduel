import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { ListEntry, TitleLanguage } from '../../anilist/types.ts'
import { BANDS, type BandIndex, type RankingState, type SubBandIndex } from '../../ranking/engine.ts'
import { BAND_UI, subBandForKey } from '../bands.ts'
import { Kao, SubPill } from '../Kao.tsx'
import { SubBandButtons } from '../SubBandChoice.tsx'
import './move.css'
import { titleName } from '../meta.ts'

type Place = { band: BandIndex; sub?: SubBandIndex }

/** The Band (and Sub-band) a title is in now, ranked or waiting for its place; null if it is in none. */
function placeOf(state: RankingState, id: number): Place | null {
  for (const band of BANDS) {
    const b = state.bands[band]
    if (!b.tiers.some((tier) => tier.includes(id)) && !b.unplaced.includes(id)) continue
    const sub = b.subBands?.findIndex((s) => s.tiers.some((tier) => tier.includes(id)) || s.unplaced.includes(id))
    return sub === undefined || sub < 0 ? { band } : { band, sub: sub as SubBandIndex }
  }
  return null
}

/**
 * Move Band bottom sheet (issue #4, M3 + R13): one button per Band; a split Band is a striped bar with one stripe per
 * Sub-band. Keys: 1-5 pick a Band (a split Band has no number key), Q / W / E a Sub-band of the first split Band,
 * Esc closes. The place the title is in now does nothing. Key presses stop here, so the screen behind ignores them.
 */
export function MoveSheet(props: {
  state: RankingState
  id: number
  entries: ReadonlyMap<number, ListEntry>
  titleLanguage: TitleLanguage
  onMove: (band: BandIndex, sub?: SubBandIndex) => void
  onClose: () => void
}) {
  const { state, id, entries, titleLanguage, onMove, onClose } = props
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => sheet.current?.focus(), [])
  const entry = entries.get(id)
  const name = titleName(entry, id, titleLanguage)
  const here = placeOf(state, id)
  const isHere = (band: BandIndex, sub?: SubBandIndex) => here?.band === band && here.sub === sub
  const stripedBand = BANDS.find((band) => state.bands[band].subBands)

  const choose = (band: BandIndex, sub?: SubBandIndex) => {
    if (!isHere(band, sub)) onMove(band, sub)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      onClose()
      return
    }
    const band = BANDS[Number(e.key) - 1]
    if (band !== undefined && !state.bands[band].subBands) {
      e.preventDefault()
      choose(band)
      return
    }
    const sub = subBandForKey(e)
    if (sub !== undefined && stripedBand !== undefined) {
      e.preventDefault()
      choose(stripedBand, sub)
    }
  }

  return (
    <div className="mv-scrim" onClick={onClose}>
      <div
        ref={sheet}
        className="mv-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${name} to another Band`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="hd">
          {entry?.coverUrl ? <img className="cv" src={entry.coverUrl} alt="" /> : <div className="cv ph" style={{ ['--c' as string]: entry?.coverColor ?? undefined }} />}
          <div className="grow">
            Move “{name}” to another Band
            {here?.sub !== undefined && (
              <div className="small">
                now in <Kao band={here.band} size={10} /> › <SubPill sub={here.sub} size={10} />
              </div>
            )}
          </div>
          <button className="mv-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={stripedBand === undefined ? 'grid' : 'grid g5s'}>
          {BANDS.map((band) =>
            state.bands[band].subBands ? (
              <div key={band} className="bandbtn stripe">
                <Kao band={band} size={13} />
                <div className="stripes">
                  <SubBandButtons
                    band={band}
                    current={here?.band === band ? here.sub : undefined}
                    keys={band === stripedBand}
                    onPick={(sub) => choose(band, sub)}
                  />
                </div>
              </div>
            ) : (
              <button
                key={band}
                className={isHere(band) ? 'bandbtn curband' : 'bandbtn'}
                disabled={isHere(band)}
                title={isHere(band) ? 'Already here' : `Move to ${BAND_UI[band].label}`}
                onClick={() => choose(band)}
              >
                <Kao band={band} size={13} />
                <span className="lab">{isHere(band) ? 'current' : BAND_UI[band].label}</span>
                <span className="kbd">{band + 1}</span>
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
