import type { BandIndex } from '../ranking/engine.ts'
import { BAND_UI } from './bands.ts'

/** A Band's kaomoji pill, at any size. */
export function Kao({ band, size }: { band: BandIndex; size: number }) {
  const { kao, colour, label } = BAND_UI[band]
  return (
    <span className="kao" style={{ background: colour, fontSize: size }} title={label}>
      {kao}
    </span>
  )
}
