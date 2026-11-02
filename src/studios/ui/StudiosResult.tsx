// Top Studios result, plain (#90): the ranked table with labels, the label legend and the watchlist. The lowered-gate
// note is in the "How sure is this?" card (studiosView). The chosen layout replaces it with #92.
import { type StudioLabel, type StudioScore, type TopStudios } from '../loadTopStudios.ts'

const LABELS: Record<StudioLabel, { icon: string; name: string; meaning: string }> = {
  elite: { icon: '💎', name: 'Elite', meaning: 'more hits than usual, few flops' },
  bold: { icon: '🎲', name: 'Bold', meaning: 'more hits and more flops than usual: it swings' },
  reliable: { icon: '🛡️', name: 'Reliable', meaning: 'few hits, few flops: it plays safe' },
  meh: { icon: '💤', name: 'Meh', meaning: 'few hits, more flops than usual' },
}

const signed = (score: number) => (score >= 0 ? '+' : '') + score.toFixed(2)

function LabelCell({ label }: { label: StudioLabel }) {
  const { icon, name } = LABELS[label]
  return (
    <td>
      <span aria-hidden="true">{icon}</span> {name}
    </td>
  )
}

function StudioRows({ studios, ranked }: { studios: StudioScore[]; ranked: boolean }) {
  return (
    <tbody>
      {studios.map((studio, i) => (
        <tr key={studio.id}>
          {ranked && <td>{i + 1}</td>}
          <td>{studio.name}</td>
          <LabelCell label={studio.label} />
          <td>{studio.votes.length}</td>
          <td>{signed(studio.score)}</td>
        </tr>
      ))}
    </tbody>
  )
}

function Head({ ranked }: { ranked: boolean }) {
  return (
    <thead>
      <tr>
        {ranked && <th>#</th>}
        <th>Studio</th>
        <th>Label</th>
        <th>Titles</th>
        <th>Studio Score</th>
      </tr>
    </thead>
  )
}

export function StudiosResult({ userName, topStudios }: { userName: string; topStudios: TopStudios }) {
  const { studios, watchlist, gate } = topStudios
  return (
    <>
      <table className="studios-table">
        <caption>
          {userName}’s studios with at least {gate} titles
        </caption>
        <Head ranked />
        <StudioRows studios={studios} ranked />
      </table>
      <section className="studios-legend" aria-label="What the labels mean">
        <dl>
          {Object.values(LABELS).map(({ icon, name, meaning }) => (
            <div key={name}>
              <dt>
                <span aria-hidden="true">{icon}</span> {name}
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
        <p>
          A hit is a title liked well above the user’s average, a flop one well below it. A label compares a studio’s
          share of each with the top 20 studios here; a share counts as high only 6 points above theirs.
        </p>
      </section>
      {watchlist.length > 0 && (
        <table className="studios-table">
          <caption>
            <span aria-hidden="true">🌱</span> Watchlist: promising, but fewer than {gate} titles seen
          </caption>
          <Head ranked={false} />
          <StudioRows studios={watchlist} ranked={false} />
        </table>
      )}
    </>
  )
}
