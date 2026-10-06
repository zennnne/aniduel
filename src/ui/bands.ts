import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SUB_BANDS, type BandIndex, type SubBandIndex } from '../ranking/engine.ts'

/** Display data for the three Sub-bands of a split Band (ADR 0006). Colours live in theme.css. */
export const SUB_BAND_UI: Record<SubBandIndex, { label: string; colour: string; key: string }> = {
  0: { label: 'Best', colour: 'var(--sub-best)', key: 'Q' },
  1: { label: 'Middle', colour: 'var(--sub-middle)', key: 'W' },
  2: { label: 'Lowest', colour: 'var(--sub-lowest)', key: 'E' },
}

/** Display data for the five Bands, top (Loved) to bottom (Hated). Colours live in theme.css. */
export const BAND_UI: Record<BandIndex, { label: string; kao: string; colour: string }> = {
  0: { label: 'Loved', kao: '(♡˙︶˙♡)', colour: 'var(--band-loved)' },
  1: { label: 'Liked', kao: '(˶ᵔ ᵕ ᵔ˶)', colour: 'var(--band-liked)' },
  2: { label: 'Okay', kao: '( ・_・)', colour: 'var(--band-okay)' },
  3: { label: 'Meh', kao: '(´・ω・`)', colour: 'var(--band-meh)' },
  4: { label: 'Hated', kao: '(×﹏×)', colour: 'var(--band-hated)' },
}

/**
 * The Sub-band a key press picks (Q / W / E = Best / Middle / Lowest), or undefined. Ignores presses with Ctrl,
 * Cmd or Alt held, so browser shortcuts still work. Shared by the Move sheet and the Board's Sub-band dialog.
 */
export function subBandForKey(e: KeyboardEvent | ReactKeyboardEvent): SubBandIndex | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined
  return SUB_BANDS.find((s) => SUB_BAND_UI[s].key === e.key.toUpperCase())
}
