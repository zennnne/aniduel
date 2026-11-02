// How each Label reads on the page: its icon, name and what it means (the map's corners and the phone's tiles).
import type { StudioLabel } from '../loadTopStudios.ts'

export const LABELS: Record<StudioLabel, { icon: string; name: string; meaning: string }> = {
  elite: { icon: '💎', name: 'Elite', meaning: 'Lots of hits, few flops' },
  bold: { icon: '🎲', name: 'Bold', meaning: 'Lots of hits, and lots of flops too' },
  reliable: { icon: '🛡️', name: 'Reliable', meaning: 'Few hits, few flops' },
  meh: { icon: '💤', name: 'Meh', meaning: 'Few hits, lots of flops' },
}

/** The map's corners, in reading order. */
export const CORNERS: StudioLabel[] = ['elite', 'bold', 'reliable', 'meh']

export const signed = (score: number) => (score >= 0 ? '+' : '−') + Math.abs(score).toFixed(2)
