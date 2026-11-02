import { Suspense, useEffect, type ComponentType } from 'react'
import type { FundBunApp } from '../core/app'
import type { AppSnapshot } from '../core/app-api'
import { Spinner, ToastProvider } from './components/ds'
import { ApprovalHost } from './components/agent'
import { AppFrame, EngineNotReady, ErrorBoundary, LockScreen, ShellActions, TabBar, TopBar } from './components/layout'
import { useMotionPreference } from './hooks/useReducedMotion'
import { lazyScreen, whenIdle, type LazyScreen } from './lazyScreen'
import { navigate, parseHash, resolveRoute, ROUTE_META, setHash, showsGlassBox, useRoute, type Location, type RouteName } from './router'
import { AppProvider, shallowEqual, syncClockOnVisible, useEngineStatus, useRetryEngine, useSnapshot, type EngineStatus } from './state'

// Every screen (and the desktop glass box) ships in its own chunk; the shell, design system and engine are the
// initial bundle. Named exports are mapped to the component the chunk is for.
const OnboardingScreen = lazyScreen(() => import('./screens/onboarding/OnboardingScreen').then((m) => m.OnboardingScreen))
const HomeScreen = lazyScreen(() => import('./screens/home/HomeScreen').then((m) => m.HomeScreen))
const InsightsScreen = lazyScreen(() => import('./screens/insights/InsightsScreen').then((m) => m.InsightsScreen))
const BillsScreen = lazyScreen(() => import('./screens/bills/BillsScreen').then((m) => m.BillsScreen))
const ChatScreen = lazyScreen(() => import('./screens/chat/ChatScreen').then((m) => m.ChatScreen))
const GoalsScreen = lazyScreen(() => import('./screens/goals/GoalsScreen').then((m) => m.GoalsScreen))
const SettingsScreen = lazyScreen(() => import('./screens/settings/SettingsScreen').then((m) => m.SettingsScreen))
const ActivityScreen = lazyScreen(() => import('./screens/activity/ActivityScreen').then((m) => m.ActivityScreen))
const GlassBoxContent = lazyScreen(() => import('./screens/glassbox/GlassBoxContent').then((m) => m.GlassBoxContent))
const OnboardingGlass = lazyScreen(() => import('./screens/glassbox/OnboardingGlass').then((m) => m.OnboardingGlass))
const Gallery = lazyScreen(() => import('./screens/Gallery').then((m) => m.default))

function GalleryRoute() {
  return (
    <Suspense fallback={<Spinner size={28} label="Loading the design system" />}>
      <Gallery />
    </Suspense>
  )
}

/** The phone-screen placeholder while a screen's chunk loads (usually never seen: chunks are prefetched). */
function ScreenLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh' }}>
      <Spinner size={28} label="Loading" />
    </div>
  )
}

/** The chunks behind the app routes and the glass box (not the design-system gallery). */
const APP_CHUNKS: readonly LazyScreen[] = [
  HomeScreen,
  OnboardingScreen,
  GlassBoxContent,
  OnboardingGlass,
  ChatScreen,
  InsightsScreen,
  BillsScreen,
  GoalsScreen,
  SettingsScreen,
  ActivityScreen,
]

/** Each route's chunk (the gallery's too). */
const ROUTE_CHUNKS: Record<RouteName, LazyScreen> = {
  onboarding: OnboardingScreen,
  home: HomeScreen,
  insights: InsightsScreen,
  bills: BillsScreen,
  chat: ChatScreen,
  goals: GoalsScreen,
  settings: SettingsScreen,
  activity: ActivityScreen,
  gallery: Gallery,
}

/**
 * The screen chunk the first render will show for this engine and address (none behind the PIN lock or when the
 * engine failed). main.tsx loads it before the first render, so the page opens on the screen rather than on
 * a loading fallback that React would then hold for its Suspense reveal throttle.
 */
export function firstScreenChunks(status: EngineStatus, hash: string): LazyScreen[] {
  const loc = parseHash(hash)
  if (loc.route === 'gallery') return [Gallery]
  if (!status.ready || status.app.isLocked()) return []
  const { route } = resolveRoute(loc, { onboarded: status.app.isOnboarded() })
  return [ROUTE_CHUNKS[route]]
}

/** Load every app screen now (tests, and before a scripted demo); resolves when all render synchronously. */
export function preloadScreens(): Promise<unknown> {
  return Promise.all(APP_CHUNKS.map((s) => s.preload()))
}

/**
 * Warm the other screens' chunks once the first screen is up and the browser is idle, one at a time so
 * they never compete with what the user is looking at. Failures are ignored (the route retries on demand).
 */
export function prefetchScreensWhenIdle(): void {
  const queue = APP_CHUNKS.filter((s) => !s.loaded)
  const next = () => {
    const screen = queue.shift()
    if (!screen) return
    screen.preload().then(() => whenIdle(next), () => whenIdle(next))
  }
  whenIdle(next)
}

/** Route → screen. Swap a placeholder for the real screen here when it lands. */
export const SCREENS: Record<RouteName, ComponentType> = {
  onboarding: OnboardingScreen,
  home: HomeScreen,
  insights: InsightsScreen,
  bills: BillsScreen,
  chat: ChatScreen,
  goals: GoalsScreen,
  settings: SettingsScreen,
  activity: ActivityScreen,
  gallery: GalleryRoute,
}

export interface AppProps {
  /** inject an engine (tests, previews); defaults to the browser singleton */
  status?: EngineStatus
}

export function App({ status }: AppProps) {
  return (
    <AppProvider status={status}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  )
}

function Shell() {
  const loc = useRoute()
  const status = useEngineStatus()
  const retry = useRetryEngine()
  if (loc.route === 'gallery') {
    return (
      <AppFrame chrome="wide" pageKey="gallery">
        <GalleryRoute />
      </AppFrame>
    )
  }
  if (!status.ready) {
    return (
      <AppFrame chrome="bare">
        <EngineNotReady error={status.error} onRetry={retry} />
      </AppFrame>
    )
  }
  return <ReadyShell app={status.app} loc={loc} />
}

/** Only what the shell needs, so screens don't re-render through the shell on every snapshot. */
function selectShell(s: AppSnapshot) {
  return {
    hasProfile: s.state.profile !== null,
    reducedMotion: s.state.settings.reducedMotion,
    glassBox: s.state.settings.glassBox,
    busy: s.derived.busy,
    awaiting: s.derived.awaiting.length,
  }
}

function ReadyShell({ app, loc }: { app: FundBunApp; loc: Location }) {
  // hasProfile flips on onboarding, demo load, unlock and reset — the moments lock/onboarded status changes
  const shell = useSnapshot(selectShell, shallowEqual)
  useMotionPreference(shell.reducedMotion)
  const locked = app.isLocked()
  const { route, redirectTo } = resolveRoute(loc, { onboarded: app.isOnboarded() })

  useEffect(() => {
    if (redirectTo && !locked) setHash(redirectTo, true)
  }, [redirectTo, locked])

  // real-data users: a tab left open overnight catches up with the device's date when it comes back into view
  // (demo personas keep their sandbox clock — the controller decides)
  useEffect(() => syncClockOnVisible(app), [app])

  if (locked) {
    return (
      <AppFrame chrome="bare">
        <LockScreen app={app} />
      </AppFrame>
    )
  }

  const meta = ROUTE_META[route]
  const Screen = SCREENS[route]
  const subPage = route === 'settings' || route === 'activity'
  const topBar = meta.topBar ? (
    <TopBar
      title={meta.title}
      brand={route === 'home'}
      onBack={meta.parent ? () => navigate(meta.parent ?? 'home') : undefined}
      actions={<ShellActions compact={subPage} />}
    />
  ) : undefined
  const tabBar = meta.tabBar ? <TabBar active={meta.tab} badges={{ chat: shell.awaiting }} /> : undefined

  return (
    <AppFrame
      chrome={meta.chrome}
      topBar={topBar}
      tabBar={tabBar}
      glassBox={
        shell.glassBox && showsGlassBox(meta) ? (
          <Suspense fallback={<Spinner size={22} label="Loading the glass box" />}>
            {shell.hasProfile ? <GlassBoxContent /> : <OnboardingGlass />}
          </Suspense>
        ) : undefined
      }
      glassBoxBusy={shell.busy}
      pageKey={route}
    >
      <ErrorBoundary
        resetKey={route}
        fallback={(error, reset) => <EngineNotReady title="This screen hit a snag" error={error.message} onRetry={reset} />}
      >
        <Suspense fallback={<ScreenLoading />}>
          <Screen />
        </Suspense>
      </ErrorBoundary>
      <ApprovalHost />
    </AppFrame>
  )
}
