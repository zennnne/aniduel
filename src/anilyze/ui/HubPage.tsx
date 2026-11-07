// The AniLyze hub in the look picked in #99: Top Studios' dark header, then one column with the mochi, the headline,
// the one username field and a card per tool. What it shows is decided by hubView.
import { useEffect, useState, type CSSProperties } from 'react'
import { sitePage } from '../../sitePages.ts'
import { Mochi } from '../../studios/ui/Bits.tsx'
import { checkLogin, type OwnName } from '../../studios/studiosLogin.ts'
import type { TopStudiosSession } from '../../studios/types.ts'
import { hubView, type HubCard, type HubLogin } from '../hubView.ts'

/** Each tool's colour: its icon badge, the word in its question, its button. */
const COLOURS: Record<HubCard['tool'], string> = { studios: 'var(--elite)', directors: 'var(--bold)' }

export function HubPage({ session }: { session: TopStudiosSession }) {
  const [own, setOwn] = useState<OwnName>(() => (session.token ? { kind: 'checking' } : { kind: 'none' }))
  const [typed, setTyped] = useState<string | null>(null)

  // Only the viewer's name: the hub fetches nothing for the tools.
  useEffect(() => {
    let live = true
    checkLogin(session).then((login) => live && setOwn(login.own))
    return () => void (live = false)
  }, [session])

  const { field, login, cards } = hubView({ own, typed })
  return (
    <div className="al-hub">
      <header className="st-hdr">
        <span className="st-logo">
          <Mochi size={34} />
          <span>
            Ani<b>Lyze</b>
          </span>
        </span>
        <a className="st-back" href={sitePage('aniduel')}>
          ← AniDuel!
        </a>
      </header>
      <main className="al-wrap">
        <div className="al-mochi">
          <Mochi size={100} className={own.kind === 'checking' ? 'bob' : undefined} />
          <span className="al-spark left" aria-hidden="true">
            ✨
          </span>
          <span className="al-spark right" aria-hidden="true">
            💗
          </span>
        </div>
        <h1 className="al-h1">
          Whose <span>list?</span>
        </h1>
        <p className="fine al-lede">Type a username, pick a tool, find out what they really love.</p>
        <div className="al-fieldrow">
          <input
            className="st-sticker"
            aria-label="AniList username"
            placeholder="AniList username"
            value={field}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <LoginLine login={login} />
        </div>
        <div className="al-cards">
          {cards.map((card) => (
            <a key={card.tool} className="al-card" href={card.href} style={{ '--c': COLOURS[card.tool] } as CSSProperties}>
              <span className="al-ic" aria-hidden="true">
                {card.icon}
              </span>
              <span className="al-tool">{card.name}</span>
              <span className="al-q">
                Which <em>{card.noun}</em> {card.who} really love?
              </span>
              <span className="fine">{card.blurb}</span>
              <span className="al-cta">{card.button}</span>
            </a>
          ))}
        </div>
      </main>
    </div>
  )
}

function LoginLine({ login }: { login: HubLogin }) {
  switch (login.kind) {
    case 'checking':
      return (
        <span className="al-you fine" aria-live="polite">
          <span className="al-spin" />{' '}
          {login.keepingTyped ? 'Checking your login… (keeping what you typed)' : 'Checking your login… your name will fill in'}
        </span>
      )
    case 'logged-in':
      return (
        <span className="al-you fine" aria-live="polite">
          Logged in as <b>{login.name}</b>
          {login.ownNameInField && ' · type any name to look someone else up'}
        </span>
      )
    case 'logged-out':
      return <span className="al-you fine">Any AniList user · no login needed</span>
  }
}
