import type { Tool } from '../tool.ts'
import type { HowSure } from './toolView.ts'

/** "How sure is this?": always shown, 5 dots and the reasons behind each one taken off. */
export function HowSureCard({ howSure, tool: { words, scoring } }: { howSure: HowSure; tool: Tool }) {
  return (
    <section className="st-sure" aria-label="How sure is this?">
      <p className="h">
        <b>How sure is this?</b>
        <span className="dots" role="img" aria-label={`${howSure.dots} of 5 dots`}>
          {'●'.repeat(howSure.dots)}
          <s>{'●'.repeat(5 - howSure.dots)}</s>
        </span>
        <b>{howSure.word}</b>
      </p>
      {howSure.notes.length > 0 ? (
        <ul>
          {howSure.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <p className="small fine">
          Plenty of scored titles and {scoring.gate.target}+ {words.many} ranked.
        </p>
      )}
    </section>
  )
}
