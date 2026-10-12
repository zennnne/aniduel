import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

export type SelectOption<T> = {
  value: T
  label: string
  /** A number shown at the right of the row, as the Picker's titles per release year. */
  count?: number
  disabled?: boolean
}

/** The list's tallest height, the room it keeps from the window's edges, and its distance from the button. */
const MAX_HEIGHT = 280
const EDGE = 8
const GAP = 6
/** Letters typed within this many ms of each other search the labels as one word. */
const TYPING_MS = 600

/**
 * A dropdown with our own list in place of the system's: a button showing the chosen option, and a list under it (over
 * it when there is no room) with a tick on the chosen row. Keys as on a `<select>`: arrows, Home, End, Enter or Space
 * to choose, Escape to close, letters to jump to a label. The list is placed against the window, so a scrolling rail or
 * sheet never cuts it; scrolling or resizing behind it closes it.
 */
export function Select<T extends string | number | null>(props: {
  /** What the control chooses, for screen readers. */
  label: string
  value: T
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  const { options, value } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState<CSSProperties | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  // Space chooses on key down; its key up would click the button and open the list again.
  const spaceChose = useRef(false)
  const id = useId()
  const chosen = options.findIndex((o) => o.value === value)

  const close = () => {
    setOpen(false)
    setPlace(null)
  }
  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    close()
    if (option.value !== value) props.onChange(option.value)
  }
  /** The next option that can be chosen from `from` going `step`, or `from` when there is none. */
  const next = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i
    return from
  }
  const row = (index: number) => list.current?.children[index] as HTMLElement | undefined
  const go = (index: number) => {
    setActive(index)
    row(index)?.scrollIntoView({ block: 'nearest' })
  }

  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return
    const r = button.current.getBoundingClientRect()
    const below = window.innerHeight - r.bottom - GAP - EDGE
    const above = r.top - GAP - EDGE
    const up = below < Math.min(MAX_HEIGHT, list.current.scrollHeight) && above > below
    setPlace({
      left: r.left,
      minWidth: r.width,
      maxHeight: Math.min(MAX_HEIGHT, up ? above : below),
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
    })
  }, [open])
  // Opens with the chosen row in the middle of the list.
  useLayoutEffect(() => {
    const el = list.current
    const on = row(chosen)
    if (place && el && on) el.scrollTop = on.offsetTop - (el.clientHeight - on.offsetHeight) / 2
  }, [place, chosen])
  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (button.current?.contains(target) || list.current?.contains(target))
    const onDown = (e: PointerEvent) => !inside(e.target) && close()
    const onScroll = (e: Event) => !(e.target instanceof Node && list.current?.contains(e.target)) && close()
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(chosen)
        setOpen(true)
      }
      return
    }
    // The list has the keys while it is open: nothing behind it hears Escape or a letter.
    e.stopPropagation()
    if (e.key === 'ArrowDown') go(next(active, 1))
    else if (e.key === 'ArrowUp') go(next(active, -1))
    else if (e.key === 'Home') go(next(-1, 1))
    else if (e.key === 'End') go(next(options.length, -1))
    else if (e.key === 'Enter' || e.key === ' ') {
      spaceChose.current = e.key === ' '
      choose(active)
    } else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') return close()
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now()
      const text = (now - typed.current.at > TYPING_MS ? '' : typed.current.text) + e.key.toLowerCase()
      typed.current = { text, at: now }
      const found = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(text))
      if (found >= 0) go(found)
    } else return
    e.preventDefault()
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`sel${open ? ' open' : ''}${props.className ? ` ${props.className}` : ''}`}
        role="combobox"
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        onClick={() => {
          if (open) return close()
          setActive(chosen)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === ' ' && spaceChose.current) e.preventDefault()
          spaceChose.current = false
        }}
      >
        <span>{options[chosen]?.label}</span>
        <i aria-hidden="true">▼</i>
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          className="sel-pop"
          role="listbox"
          aria-label={props.label}
          style={place ?? { visibility: 'hidden' }}
          // Keeps the focus, and so the keys, on the button.
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((option, i) => (
            <div
              key={String(option.value)}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === chosen}
              aria-disabled={option.disabled || undefined}
              className={`sel-it${i === chosen ? ' on' : ''}${i === active ? ' act' : ''}${option.disabled ? ' off' : ''}`}
              onClick={() => choose(i)}
              onMouseMove={() => !option.disabled && i !== active && setActive(i)}
            >
              <i aria-hidden="true">✓</i>
              <span>{option.label}</span>
              {option.count !== undefined && <em>{option.count}</em>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
