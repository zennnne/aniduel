// Top Studios' old path, /aniduel/studios/ (studios/index.html): forward to its page under AniLyze (ADR 0016), the
// query and hash kept. `replace`, so Back doesn't land here again.
import { movedStudiosUrl } from './sitePages.ts'

window.location.replace(movedStudiosUrl(window.location))
