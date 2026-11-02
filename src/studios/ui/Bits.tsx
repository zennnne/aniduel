// Small pieces the Top Studios page repeats: the mochi, hearts, a label pill, a measured box.
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { StudioLabel } from '../loadTopStudios.ts'
import { LABELS, signed } from './labels.ts'

/** AniDuel!'s mochi, as a plain pink dome with a face. Decorative. */
export function Mochi({ face = 'ok', size = 34, className }: { face?: 'ok' | 'sad'; size?: number; className?: string }) {
  return (
    <svg className={`st-mochi ${className ?? ''}`} width={size} height={size * 0.76} viewBox="0 0 100 76" aria-hidden="true">
      <path d="M4 60 C2 26 26 4 50 4 C74 4 98 26 96 60 C95 72 84 74 50 74 C16 74 5 72 4 60 Z" className="body" />
      <ellipse cx="28" cy="48" rx="6" ry="3.5" className="cheek" />
      <ellipse cx="72" cy="48" rx="6" ry="3.5" className="cheek" />
      {face === 'ok' ? (
        <g className="ink">
          <circle cx="38" cy="40" r="3.6" />
          <circle cx="62" cy="40" r="3.6" />
          <path d="M45 47 q5 5 10 0" className="line" />
        </g>
      ) : (
        <g className="ink">
          <circle cx="38" cy="42" r="3.2" />
          <circle cx="62" cy="42" r="3.2" />
          <path d="M45 53 q5 -5 10 0" className="line" />
        </g>
      )}
    </svg>
  )
}

/** The Studio Score as 0–5 hearts; the raw S only in the tooltip. */
export function Hearts({ hearts, score, big }: { hearts: number; score: number; big?: boolean }) {
  return (
    <span
      className={big ? 'st-hearts big' : 'st-hearts'}
      title={`Studio Score ${signed(score)}`}
      role="img"
      aria-label={`${hearts} of 5 hearts`}
    >
      {'♥'.repeat(hearts)}
      <s>{'♥'.repeat(5 - hearts)}</s>
    </span>
  )
}

export function LabelPill({ label }: { label: StudioLabel }) {
  const { icon, name } = LABELS[label]
  return (
    <span className={`st-lab ${label}`}>
      <span aria-hidden="true">{icon}</span> {name}
    </span>
  )
}

/** An element's width, kept up to date as it resizes (the map and the swarm lay out in pixels). */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
