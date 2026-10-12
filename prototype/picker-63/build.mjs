// Bakes data.json into a source file and writes one standalone HTML file beside it.
// `node build.mjs` builds picker.src.html -> picker.html; `node build.mjs rounds/round1-overall-shape.src.html` builds a round.
import { readFileSync, writeFileSync } from 'node:fs'
const at = (f) => new URL(f, import.meta.url)
const src = process.argv[2] ?? 'picker.src.html'
const out = src.replace(/\.src\.html$/, '.html')
const data = readFileSync(at('./data.json'), 'utf8').replace(/</g, '\u003c')
writeFileSync(at(`./${out}`), readFileSync(at(`./${src}`), 'utf8').replace('/*DATA*/null', () => data))
console.log(`${out} written`)
