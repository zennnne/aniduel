# No client-side router; screens are driven by app state

AniDuel! is a static site on GitHub Pages at `<user>.github.io/aniduel/`. AniList's implicit grant puts the access token in the URL fragment (`#access_token=...`). A hash router would clash with that fragment, and GitHub Pages has no fallback that sends unknown paths to the app, so BrowserRouter would need the `404.html` redirect hack. So we use no router at all. The current screen comes from app state. On load we read the fragment and clear it with `history.replaceState`, and we push history entries by hand at key steps so the browser's back button still works reasonably.

## Considered Options

- **BrowserRouter with the `404.html` redirect**: gives clean URLs, but the hack is fragile and the first load returns a 404 status.
- **HashRouter that reads the token before the router starts**: possible, but the startup order is brittle.

## Consequences

- There are no deep links into screens, which is fine because a Ranking lives in the user's own browser and can't be shared by URL anyway.
- The Vite `base` must be `/aniduel/`, and the AniList app's redirect URL must match the deployed URL exactly.
