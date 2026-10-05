/**
 * App menu items (issue #4 prototype, section 9). One list feeds both the account popover at the bottom of
 * the sidebar and the Ctrl+K palette, so a ticket adds an action (e.g. "Split a Band") by adding one MenuItem
 * to the list App builds.
 */
export type MenuGroup = 'This Ranking' | 'App' | 'Account'
export const MENU_GROUPS: readonly MenuGroup[] = ['This Ranking', 'App', 'Account']

export type MenuItem = {
  /** Stable key, e.g. 'backup'. */
  id: string
  group: MenuGroup
  /** One character shown in the icon square. */
  icon: string
  title: string
  description: string
  /** Red text, for actions that throw something away. */
  danger?: boolean
  run: () => void
}

/** Case-insensitive substring match on the title or description. */
export function filterMenuItems(items: readonly MenuItem[], query: string): MenuItem[] {
  const q = query.trim().toLowerCase()
  return items.filter((i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
}
