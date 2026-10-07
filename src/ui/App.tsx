import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import type { FundBunApp } from '../core/app'
import type { AppSnapshot } from '../core/app-api'
import { Spinner, ToastProvider } from './components/ds'
import { ApprovalHost } from './components/agent'
import { AppFrame, EngineNotReady, ErrorBoundary, LockScreen, ShellActions, TabBar, TopBar } from './components/layout'
import { useMotionPreference } from './hooks/useReducedMotion'
import { navigate, resolveRoute, ROUTE_META, setHash, useRoute, type Location, type RouteName } from './router'
import {
  ActivityScreen,
  BillsScreen,
  ChatScreen,
  GlassBoxContent,
  GoalsScreen,
  HomeScreen,
  InsightsScreen,
  OnboardingScreen,
  SettingsScreen,
} from './screens'
import { AppProvider, shallowEqual, useEngineStatus, useRetryEngine, useSnapshot, type EngineStatus } from './state'

const LazyGallery = lazy(() => import('./screens/Gallery'))

function GalleryRoute() {
  return (
    <Suspense fallback={<Spinner size={28} label="Loading the design system" />}>
      <LazyGallery />
    </Suspense>
  )
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
      glassBox={shell.glassBox && meta.chrome === 'app' ? <GlassBoxContent /> : undefined}
      glassBoxBusy={shell.busy}
      pageKey={route}
    >
      <ErrorBoundary
        resetKey={route}
        fallback={(error, reset) => <EngineNotReady title="This screen hit a snag" error={error.message} onRetry={reset} />}
      >
        <Screen />
      </ErrorBoundary>
      <ApprovalHost />
    </AppFrame>
  )
}
