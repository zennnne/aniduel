// How each Label reads on the page: its icon, name and what it means (the map's corners and the phone's tiles).
import { LABEL_GRID, labelRates, type StudioLabel } from '../loadTopStudios.ts'

type LabelLook = { icon: string; name: string; meaning: string }

/** Its icon and name; what it means ("Lots of hits, few flops", …) comes from which of its rates read high. */
function look(label: StudioLabel, icon: string, name: string): LabelLook {
  const { hitsHigh, flopsHigh } = labelRates(label)
  const flops = flopsHigh ? (hitsHigh ? 'and lots of flops too' : 'lots of flops') : 'few flops'
  return { icon, name, meaning: `${hitsHigh ? 'Lots of hits' : 'Few hits'}, ${flops}` }
}

export const LABELS: Record<StudioLabel, LabelLook> = {
  elite: look('elite', '💎', 'Elite'),
  bold: look('bold', '🎲', 'Bold'),
  reliable: look('reliable', '🛡️', 'Reliable'),
  meh: look('meh', '💤', 'Meh'),
}

/** The map's corners, in reading order. */
export const CORNERS: readonly StudioLabel[] = LABEL_GRID

export const signed = (score: number) => (score >= 0 ? '+' : '−') + Math.abs(score).toFixed(2)
