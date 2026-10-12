import { useEffect, useState } from 'react'

/** Phone width: where screens switch to their one-column layouts (the breakpoint theme.css uses too). */
const MOBILE = '(max-width: 720px)'

/** Whether the window is at phone width, kept up to date as it is resized. */
export function useMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia?.(MOBILE).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(MOBILE)
    if (!query) return
    const onChange = () => setMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}
