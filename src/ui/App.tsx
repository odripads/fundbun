import { Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import type { FundBunApp } from '../core/app'
import type { AppSnapshot } from '../core/app-api'
import { Spinner, ToastProvider } from './components/ds'
import { ApprovalHost } from './components/agent'
import { deskParent, deskTitle } from './components/desk/deskModel'
import type { DeskShellProps } from './components/desk/DeskShell'
import { isDeskModeNow, useDeskMode, useDeskViewport } from './components/desk/useDeskMode'
import { DesktopViewButton } from './components/desk/ViewSwitch'
import { AppFrame, EngineNotReady, ErrorBoundary, LockScreen, ShellActions, TabBar, TopBar } from './components/layout'
import { useMotionPreference } from './hooks/useReducedMotion'
import { lazyScreen, whenIdle, type LazyScreen } from './lazyScreen'
import { buildHash, navigate, parseHash, resolveRoute, ROUTE_META, setHash, showsGlassBox, useRoute, type Location, type RouteName } from './router'
import { AppProvider, shallowEqual, syncClockOnVisible, useEngineStatus, useRetryEngine, useSnapshot, type EngineStatus } from './state'

// Every screen (and the desktop glass box) ships in its own chunk; the shell, design system and engine are the
// initial bundle. Named exports are mapped to the component the chunk is for.
const OnboardingScreen = lazyScreen(() => import('./screens/onboarding/OnboardingScreen').then((m) => m.OnboardingScreen))
const HomeScreen = lazyScreen(() => import('./screens/home/HomeScreen').then((m) => m.HomeScreen))
const InsightsScreen = lazyScreen(() => import('./screens/insights/InsightsScreen').then((m) => m.InsightsScreen))
const BillsScreen = lazyScreen(() => import('./screens/bills/BillsScreen').then((m) => m.BillsScreen))
const ChatScreen = lazyScreen<{ variant?: 'page' | 'panel' }>(() => import('./screens/chat/ChatScreen').then((m) => m.ChatScreen))
const GoalsScreen = lazyScreen(() => import('./screens/goals/GoalsScreen').then((m) => m.GoalsScreen))
const SettingsScreen = lazyScreen(() => import('./screens/settings/SettingsScreen').then((m) => m.SettingsScreen))
const ActivityScreen = lazyScreen(() => import('./screens/activity/ActivityScreen').then((m) => m.ActivityScreen))
const ReceiptScreen = lazyScreen(() => import('./screens/receipt/ReceiptScreen').then((m) => m.ReceiptScreen))
const GlassBoxContent = lazyScreen(() => import('./screens/glassbox/GlassBoxContent').then((m) => m.GlassBoxContent))
const OnboardingGlass = lazyScreen(() => import('./screens/glassbox/OnboardingGlass').then((m) => m.OnboardingGlass))
const Gallery = lazyScreen(() => import('./screens/Gallery').then((m) => m.default))
// the desk layout (wide windows): its shell and its dashboard are two more chunks, never fetched on a phone
const DeskShell = lazyScreen<DeskShellProps>(() => import('./components/desk/DeskShell').then((m) => m.DeskShell))
const DashboardScreen = lazyScreen(() => import('./screens/dashboard/DashboardScreen').then((m) => m.DashboardScreen))

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
  ReceiptScreen,
]

/** The desk layout's own chunks: loaded with the first screen on a wide window, and by preloadScreens(). */
const DESK_CHUNKS: readonly LazyScreen[] = [DeskShell as LazyScreen, DashboardScreen]

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
  receipt: ReceiptScreen,
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
  if (isDeskModeNow() && ROUTE_META[route].chrome === 'app') return [DeskShell as LazyScreen, deskScreen(route) as LazyScreen]
  return [ROUTE_CHUNKS[route]]
}

/** Load every app screen now (tests, and before a scripted demo); resolves when all render synchronously. */
export function preloadScreens(): Promise<unknown> {
  return Promise.all([...APP_CHUNKS, ...DESK_CHUNKS].map((s) => s.preload()))
}

/**
 * Warm the other screens' chunks once the first screen is up and the browser is idle, one at a time so
 * they never compete with what the user is looking at. Failures are ignored (the route retries on demand).
 */
export function prefetchScreensWhenIdle(): void {
  // the desk chunks only when this window uses them (a phone never downloads the dashboard)
  const queue = [...(isDeskModeNow() ? DESK_CHUNKS : []), ...APP_CHUNKS].filter((s) => !s.loaded)
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
  receipt: ReceiptScreen,
  gallery: GalleryRoute,
}

/**
 * What the desk work area shows for a route: Home is the dashboard there, and the chat is the side panel, so its
 * route keeps the dashboard (or whatever screen was open) in the work area.
 */
function deskScreen(route: RouteName): ComponentType {
  return route === 'home' || route === 'chat' ? DashboardScreen : SCREENS[route]
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
  // a wide window gets the desk layout unless the user picked the phone view (never in jsdom: no matchMedia)
  const desk = useDeskMode()
  const wide = useDeskViewport()
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
  if (desk && meta.chrome === 'app') return <DeskApp route={route} loc={loc} awaiting={shell.awaiting} busy={shell.busy} />

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
    <>
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
      {/* the phone view on a window wide enough for the desk layout: the way back, beside the device */}
      {wide && !desk && meta.chrome === 'app' ? <DesktopViewButton /> : null}
    </>
  )
}

/** A screen in the work area, with the same error boundary and loading fallback the phone frame gives it. */
function ScreenSlot({ route, children }: { route: RouteName; children: ReactNode }) {
  return (
    <ErrorBoundary
      resetKey={route}
      fallback={(error, reset) => <EngineNotReady title="This screen hit a snag" error={error.message} onRetry={reset} />}
    >
      <Suspense fallback={<ScreenLoading />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

/**
 * The desk layout for an app route. The chat has no page of its own here: the `chat` route opens the side panel on
 * Ask Bun and hands the address back to the screen that was showing, so "Ask Bun" from anywhere keeps that screen
 * in view beside the conversation (and every later navigate('chat') is a fresh request).
 */
function DeskApp({ route, loc, awaiting, busy }: { route: RouteName; loc: Location; awaiting: number; busy: boolean }) {
  const isChat = route === 'chat'
  const last = useRef<{ route: RouteName; hash: string }>({ route: 'home', hash: buildHash('home') })
  const [chatRequest, setChatRequest] = useState(0)
  if (!isChat) last.current = { route, hash: buildHash(route, loc.params, loc.query) }
  const mainRoute = isChat ? last.current.route : route

  useEffect(() => {
    if (!isChat) return
    setChatRequest((n) => n + 1)
    setHash(last.current.hash, true)
  }, [isChat])

  const Screen = deskScreen(mainRoute)
  return (
    <Suspense fallback={<ScreenLoading />}>
      <DeskShell
        route={mainRoute}
        title={deskTitle(mainRoute)}
        parent={deskParent(mainRoute)}
        pageKey={mainRoute}
        column={mainRoute !== 'home'}
        awaiting={awaiting}
        busy={busy}
        chatRequest={chatRequest}
        chat={
          <ScreenSlot route="chat">
            <ChatScreen variant="panel" />
          </ScreenSlot>
        }
        glassBox={
          <Suspense fallback={<Spinner size={22} label="Loading the glass box" />}>
            <GlassBoxContent />
          </Suspense>
        }
      >
        <ScreenSlot route={mainRoute}>
          <Screen />
        </ScreenSlot>
        <ApprovalHost />
      </DeskShell>
    </Suspense>
  )
}
