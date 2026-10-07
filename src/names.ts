// Ordering titles by display name, wherever titles have no order of their own (e.g. on one score level, #25).

/** Display names in alphabetical order, ignoring case and accents, with numbers in numeric order. */
export function compareNames(x: string, y: string): number {
  return x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true })
}
