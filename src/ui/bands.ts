import type { BandIndex } from '../ranking/engine.ts'

/** Display data for the five Bands, top (Loved) to bottom (Hated). Colours live in theme.css. */
export const BAND_UI: Record<BandIndex, { label: string; kao: string; colour: string }> = {
  0: { label: 'Loved', kao: '(♡˙︶˙♡)', colour: 'var(--band-loved)' },
  1: { label: 'Liked', kao: '(˶ᵔ ᵕ ᵔ˶)', colour: 'var(--band-liked)' },
  2: { label: 'Okay', kao: '( ・_・)', colour: 'var(--band-okay)' },
  3: { label: 'Meh', kao: '(´・ω・`)', colour: 'var(--band-meh)' },
  4: { label: 'Hated', kao: '(×﹏×)', colour: 'var(--band-hated)' },
}
