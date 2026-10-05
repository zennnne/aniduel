import type { ReactNode } from 'react'

export type Notice = {
  tone: 'error' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}

/**
 * The "Cockpit" layout (issue #4): an optional sidebar on the left and the main area on the right,
 * with one slim banner at the top of the main area. Start has no sidebar.
 */
export function Shell(props: { sidebar?: ReactNode; notice?: Notice | null; children: ReactNode }) {
  const { sidebar, notice, children } = props
  return (
    <div className={sidebar ? 'shell with-side' : 'shell'}>
      {sidebar && <aside className="side">{sidebar}</aside>}
      <main className="main">
        {notice && (
          <div className={notice.tone === 'info' ? 'banner info' : 'banner'} role="alert">
            <span className="grow">{notice.message}</span>
            {notice.action && <button onClick={notice.action.onClick}>{notice.action.label}</button>}
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
