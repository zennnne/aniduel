import type { ExitOffer } from '../../catchup/exitOffer.ts'
import './exitOffer.css'

/** The exit offer in Catch-up's header (#52): green, not pulsing, once titles were added this visit. */
export function ExitOfferButton({ offer, onTake }: { offer: ExitOffer; onTake: (offer: ExitOffer) => void }) {
  return (
    <button className="cu-exit" onClick={() => onTake(offer)}>
      {offer.label}
    </button>
  )
}
