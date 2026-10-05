import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Dialog shell (issue #4): scrim (click = cancel) > box with a title, a body, then Cancel + the action on the right.
 * Focus moves into the dialog and its key presses stop there, so screen shortcuts (1-5, Backspace) don't fire behind it.
 */
export function Dialog(props: { title: ReactNode; onCancel: () => void; actions: ReactNode; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  return (
    <div className="dscrim" onClick={props.onCancel}>
      <div
        ref={box}
        tabIndex={-1}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={typeof props.title === 'string' ? props.title : undefined}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') props.onCancel()
        }}
      >
        <div className="h2">{props.title}</div>
        {props.children}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
          <button className="link" onClick={props.onCancel}>
            Cancel
          </button>
          {props.actions}
        </div>
      </div>
    </div>
  )
}
