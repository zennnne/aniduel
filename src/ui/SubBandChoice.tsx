import { SUB_BANDS, type BandIndex, type SubBandIndex } from '../ranking/engine.ts'
import { BAND_UI, SUB_BAND_UI } from './bands.ts'

/**
 * The Sub-band choice of a split Band (ADR 0006), shared by the Move sheet and the Board: one button per Sub-band in
 * its colour, with its Q / W / E key when `keys` is on. The Sub-band the title is in now (`current`) is disabled.
 * The caller lays the buttons out (they render without a wrapper) and handles the keys with `subBandForKey`.
 */
export function SubBandButtons(props: {
  band: BandIndex
  current?: SubBandIndex
  keys: boolean
  autoFocus?: boolean
  onPick: (sub: SubBandIndex) => void
}) {
  const { band, current, keys, autoFocus, onPick } = props
  return SUB_BANDS.map((sub) => {
    const here = sub === current
    return (
      <button
        key={sub}
        className={here ? 'cur' : undefined}
        style={{ background: SUB_BAND_UI[sub].colour }}
        disabled={here}
        title={here ? 'Already here' : `${BAND_UI[band].label} › ${SUB_BAND_UI[sub].label}`}
        autoFocus={autoFocus && sub === (current === 0 ? 1 : 0)}
        onClick={() => onPick(sub)}
      >
        {SUB_BAND_UI[sub].label}
        {keys && <span className="kbd">{SUB_BAND_UI[sub].key}</span>}
      </button>
    )
  })
}
