// Line icons from the prototype (issue #4): 24x24, stroke currentColor, class "li".
import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="li" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const UNDO_ICON = (
  <Icon>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
)

export const EXT_ICON = (
  <Icon>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </Icon>
)

export const SAME_ICON = (
  <Icon>
    <path d="M4 9c2.5-2 5.5 2 8 0s5.5-2 8 0" />
    <path d="M4 15c2.5-2 5.5 2 8 0s5.5-2 8 0" />
  </Icon>
)
