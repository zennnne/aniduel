// The "All N titles" swarm (#89): an opened studio's scored titles as round covers along the user's score line, sized
// by vote weight W, nudged up and down so none overlap. Pure geometry in pixels of the box it is given.

export type SwarmBead<T> = { item: T; x: number; y: number; r: number }
export type Swarm<T> = {
  beads: SwarmBead<T>[]
  /** Whole scores to label under the line. */
  ticks: number[]
  /** The x of a score on the line (the "your usual" mark). */
  at: (score: number) => number
  /** The height the beads took: the box's, or taller when a crowded score needed more room. */
  height: number
}

/** A box narrower than this gets smaller beads. */
const SMALL_BOX = 480

export function swarm<T extends { score: number; weight: number }>(
  items: readonly T[],
  usual: number,
  box: { width: number; height: number },
): Swarm<T> {
  const { width } = box
  let { height } = box
  const small = width < SMALL_BOX
  const low = Math.max(1, Math.floor(Math.min(usual, ...items.map((t) => t.score)))) - 0.5
  const high = 10.5
  const at = (score: number) => ((score - low) / (high - low)) * width
  const heaviest = Math.max(...items.map((t) => t.weight))
  const beads = items
    .map((item) => ({ item, x: at(item.score), y: height / 2, r: (small ? 9 : 12) + (item.weight / heaviest) * (small ? 8 : 12) }))
    .sort((a, b) => b.r - a.r)

  for (let round = 0; round < 8; round++) {
    for (let it = 0; it < 260; it++) {
      // Each bead drifts back toward its score and the middle of the line; then overlapping ones part. The last
      // rounds only part them, so the drift leaves no overlap behind.
      if (it < 200)
        for (const b of beads) {
          b.y += (height / 2 - b.y) * 0.02
          b.x += (at(b.item.score) - b.x) * 0.2
        }
      for (let i = 0; i < beads.length; i++)
        for (let j = i + 1; j < beads.length; j++) {
          const a = beads[i]
          const b = beads[j]
          const dx = b.x - a.x
          // Beads on one score part up and down, alternately.
          const dy = b.y - a.y || ((i + j) % 2 ? 0.01 : -0.01)
          const d = Math.hypot(dx, dy)
          const min = a.r + b.r + 1
          if (d < min) {
            const p = (min - d) / 2
            a.y -= (dy / d) * p
            b.y += (dy / d) * p
            a.x -= (dx / d) * p * 0.15
            b.x += (dx / d) * p * 0.15
          }
        }
      for (const b of beads) {
        b.y = Math.max(b.r, Math.min(height - b.r, b.y))
        b.x = Math.max(b.r, Math.min(width - b.r, b.x))
      }
    }
    const crowded = beads.some((a, i) => beads.slice(i + 1).some((b) => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r))
    if (!crowded) break
    // A crowded score gets more room rather than smaller covers.
    height *= 1.2
  }

  const ticks: number[] = []
  for (let v = Math.ceil(low); v <= 10; v++) ticks.push(v)
  return { beads, ticks, at, height }
}
