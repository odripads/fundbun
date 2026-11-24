/** Pure helpers for the desk shell (unit-tested in desk.test.ts). */
import { parseDate } from '../../../core/dates'
import type { ISODate } from '../../../core/types'
import { ROUTE_META, type RouteName } from '../../router'

export interface DeskNavItem {
  route: RouteName
  label: string
}

/** The sidebar's main navigation, top to bottom. */
export const DESK_NAV: readonly DeskNavItem[] = [
  { route: 'home', label: 'Dashboard' },
  { route: 'insights', label: 'Insights' },
  { route: 'bills', label: 'Bills' },
  { route: 'goals', label: 'Goals' },
  { route: 'activity', label: 'Activity' },
]

/** Routes the sidebar links to directly (so the top bar needs no back button for them). */
export const DESK_ROOTS: ReadonlySet<RouteName> = new Set<RouteName>([...DESK_NAV.map((n) => n.route), 'settings'])

/** The page title in the desk top bar: Home is the Dashboard here, every other route keeps its name. */
export function deskTitle(route: RouteName): string {
  return route === 'home' ? 'Dashboard' : ROUTE_META[route].title
}

/** Where the top bar's back button goes, for a route the sidebar does not list (the receipt reader). */
export function deskParent(route: RouteName): RouteName | undefined {
  return DESK_ROOTS.has(route) ? undefined : ROUTE_META[route].parent
}

/** "Thu, Oct 22, 2026" */
export function longDate(d: ISODate): string {
  return parseDate(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * With no saved choice, the side panel starts open when the window leaves the dashboard two columns beside it; on
 * a narrower window it starts shut (the top bar's "Ask Bun" button opens it).
 */
export const PANEL_DEFAULT_OPEN_WIDTH = 1360

export function defaultPanelOpen(windowWidth: number | undefined): boolean {
  return windowWidth === undefined || !Number.isFinite(windowWidth) || windowWidth >= PANEL_DEFAULT_OPEN_WIDTH
}

/** "Ask Bun" / "Ask Bun, 2 waiting for your OK" */
export function chatTabName(awaiting: number): string {
  if (awaiting <= 0) return 'Ask Bun'
  return `Ask Bun, ${awaiting} waiting for your OK`
}
