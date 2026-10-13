import './storageBlocked.css'

/**
 * Shown in place of the app when the browser blocks site storage (#76). Nothing of the app is mounted with it, so it
 * follows the system theme: the remembered one lives in the storage it can't read.
 */
export function StorageBlockedScreen() {
  return (
    <main className="blk">
      <div className="blk-panel" role="alert">
        <h1>This browser blocks site storage</h1>
        <p>AniDuel! keeps your login and all your progress in this browser's storage, so it can't run without it.</p>
        <p>Allow site data for this site, then reload the page.</p>
        <button className="go" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </main>
  )
}
