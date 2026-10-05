import { useEffect, useState } from 'react'

// Theme follows prefers-color-scheme until the user toggles it; the choice is remembered.
export type Theme = 'light' | 'dark'

const THEME_KEY = 'aniduel/theme'

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function storedTheme(): Theme | null {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : null
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [chosen, setChosen] = useState<Theme | null>(storedTheme)
  const [system, setSystem] = useState<Theme>(systemTheme)

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (chosen) document.documentElement.dataset.theme = chosen
    else delete document.documentElement.dataset.theme
  }, [chosen])

  const theme = chosen ?? system
  return {
    theme,
    toggleTheme: () => {
      const next: Theme = theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      setChosen(next)
    },
  }
}
