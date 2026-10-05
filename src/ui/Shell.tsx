import { useState, type ReactNode } from 'react'

export type Notice = {
  tone: 'error' | 'info'
  message: string
  action?: { label: string; onClick: () => void }
}

/**
 * The "Cockpit" layout (issue #4): an optional sidebar on the left and the main area on the right,
 * with one slim banner at the top of the main area. Start has no sidebar.
 */
export function Shell(props: { sidebar?: ReactNode; notice?: Notice | null; toast?: ReactNode; children: ReactNode }) {
  const { sidebar, notice, toast, children } = props
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className={sidebar ? (collapsed ? 'shell with-side collapsed' : 'shell with-side') : 'shell'}>
      {sidebar && (
        <aside className="side">
          {!collapsed && sidebar}
          <button
            className="side-toggle hide-m"
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '»' : '«'}
          </button>
        </aside>
      )}
      <main className="main">
        {notice && (
          <div className={notice.tone === 'info' ? 'banner info' : 'banner'} role="alert">
            <span className="grow">{notice.message}</span>
            {notice.action && <button onClick={notice.action.onClick}>{notice.action.label}</button>}
          </div>
        )}
        {children}
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
