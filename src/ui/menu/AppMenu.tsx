import { useEffect, useEffectEvent, useRef, useState } from 'react'
import './menu.css'
import { MENU_GROUPS, filterMenuItems, type MenuItem } from './menuItems.ts'

function MenuEntry(props: { item: MenuItem; first?: boolean; onRun: () => void }) {
  const { item } = props
  const cls = ['mitem', item.danger && 'danger', props.first && 'first'].filter(Boolean).join(' ')
  return (
    <button className={cls} role="menuitem" onClick={props.onRun}>
      <span className="mic" aria-hidden="true">
        {item.icon}
      </span>
      <span className="col" style={{ gap: 2 }}>
        <span>{item.title}</span>
        <span className="small">{item.description}</span>
      </span>
    </button>
  )
}

/** The account button at the bottom of the sidebar; it opens the items grouped by MENU_GROUPS. */
export function AccountMenu(props: {
  name: string
  avatarUrl: string | null
  /** e.g. "Anime · 142 titles" */
  detail: string
  items: readonly MenuItem[]
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="acct-wrap" ref={wrap}>
      {open && (
        <div className="mpop" role="menu">
          {MENU_GROUPS.map((group) => {
            const items = props.items.filter((i) => i.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="mgroup">
                <div className="mg">{group}</div>
                {items.map((item) => (
                  <MenuEntry
                    key={item.id}
                    item={item}
                    onRun={() => {
                      setOpen(false)
                      item.run()
                    }}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}
      <button className="acct" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {props.avatarUrl ? <img className="ava" src={props.avatarUrl} alt="" /> : <span className="ava">{props.name[0]}</span>}
        <span className="grow hide-m">
          {props.name}
          <br />
          <span className="small">{props.detail}</span>
        </span>
        <span aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
    </div>
  )
}

/** Ctrl/Cmd+K palette: type to filter, Enter runs the first match, Esc closes. Mount once while logged in. */
export function CommandPalette(props: { items: readonly MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      setQuery('')
      setOpen(true)
    }
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (!open) return null
  const matches = filterMenuItems(props.items, query)
  const run = (item: MenuItem) => {
    setOpen(false)
    item.run()
  }
  return (
    <div className="dscrim top" onClick={() => setOpen(false)}>
      <div className="pal" role="dialog" aria-label="Actions" onClick={(e) => e.stopPropagation()}>
        <input
          id="palq"
          autoFocus
          placeholder="Type an action… (backup, manga, log out)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'Enter' && matches[0]) run(matches[0])
          }}
        />
        <div role="menu" className="col" style={{ gap: 2 }}>
          {matches.length === 0 ? (
            <div className="small" style={{ padding: 8 }}>
              No action
            </div>
          ) : (
            matches.map((item, i) => <MenuEntry key={item.id} item={item} first={i === 0} onRun={() => run(item)} />)
          )}
        </div>
      </div>
    </div>
  )
}
