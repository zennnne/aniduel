// A small seeded hash for every choice replay must make the same way each time (ADR 0005): which card is on the
// left, which titles are sorted first, which Anchor a new title meets. Never `Math.random`.

/** `hash(seed, a, b)`: 32-bit FNV-1a over the three words, then a final mix. */
export function sideHash(seed: number, low: number, high: number): number {
  let h = 0x811c9dc5
  for (const word of [seed, low, high]) {
    for (let shift = 0; shift < 32; shift += 8) {
      h ^= (word >>> shift) & 0xff
      h = Math.imul(h, 0x01000193)
    }
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return h >>> 0
}
