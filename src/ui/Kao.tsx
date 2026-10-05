import type { ReactNode } from 'react'
import type { BandIndex, SubBandIndex } from '../ranking/engine.ts'
import { BAND_UI, SUB_BAND_UI } from './bands.ts'

/** A Sub-band pill ("Best", "Middle 34", …) in that Sub-band's colour. */
export function SubPill({ sub, size, children }: { sub: SubBandIndex; size: number; children?: ReactNode }) {
  return (
    <span className="kao" style={{ background: SUB_BAND_UI[sub].colour, fontSize: size }}>
      {children ?? SUB_BAND_UI[sub].label}
    </span>
  )
}

/** A Band's kaomoji pill, at any size. */
export function Kao({ band, size }: { band: BandIndex; size: number }) {
  const { kao, colour, label } = BAND_UI[band]
  return (
    <span className="kao" style={{ background: colour, fontSize: size }} title={label}>
      {kao}
    </span>
  )
}
