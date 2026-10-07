/**
 * Placeholder screens so routing compiles while the real screens are built. Each real screen replaces its
 * export here (or App.tsx's SCREENS map is pointed at the new file). Keep these tiny.
 */
import { Sparkles } from 'lucide-react'
import { navigate } from '../router'
import { useApp } from '../state/useApp'
import { useSafeAction } from '../state/useSafeAction'
import { Button, EmptyState, SkeletonText } from '../components/ds'
import { ScreenTopBar } from '../components/layout/ScreenTopBar'

function Placeholder({ name }: { name: string }) {
  return <EmptyState title={`${name} is on the way`} body="This screen is being built. The shell, navigation and design system are ready for it." mood="sleepy" />
}

export function OnboardingScreen() {
  const app = useApp()
  const run = useSafeAction()
  return (
    <EmptyState
      title="Meet Bun"
      body="Onboarding is being built. Meanwhile, try the sandbox demo."
      mood="happy"
      action={
        <Button
          iconStart={<Sparkles />}
          onClick={async () => {
            await run(() => app.loadDemo('mei'), { errorTitle: 'The demo isn’t ready yet' })
            if (app.isOnboarded()) navigate('home')
          }}
        >
          Try the demo
        </Button>
      }
    />
  )
}

export const HomeScreen = () => <Placeholder name="Home" />
export const InsightsScreen = () => <Placeholder name="Insights" />
export const BillsScreen = () => <Placeholder name="Bills" />
export const GoalsScreen = () => <Placeholder name="Goals" />
export const SettingsScreen = () => <Placeholder name="Settings" />
export const ActivityScreen = () => <Placeholder name="Activity" />

/** Chat renders its own TopBar (ROUTE_META.chat.topBar === false). */
export function ChatScreen() {
  return (
    <>
      <ScreenTopBar title="Ask Bun" onBack={() => navigate('home')} />
      <Placeholder name="Chat" />
    </>
  )
}

/** Desktop glass-box panel content (the agent trace / policy / audit views replace this). */
export function GlassBoxContent() {
  return (
    <div aria-busy="true">
      <SkeletonText lines={4} />
    </div>
  )
}
