/**
 * #/gallery — every design-system component with fake data, light and dark side by side, for visual QA.
 * Works without the engine (no useApp), so it renders even while core modules are stubs.
 */
import { ArrowLeftRight, Bell, CalendarClock, Coffee, Monitor, Moon, Plus, Send, Settings, Sparkles, Sun, Trash2, Undo2, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { CATEGORIES } from '../../core/categories'
import type { Autonomy, CategoryId, Tier, Tone } from '../../core/types'
import { BunMascot, DreamImage, Logo } from '../components/brand'
import {
  AiBadge,
  Badge,
  BarChart,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  Chip,
  Dialog,
  Donut,
  EmptyState,
  IconButton,
  List,
  ListItem,
  Money,
  PinPad,
  ProgressBar,
  ProgressRing,
  SectionHeader,
  Segmented,
  Sheet,
  Skeleton,
  SkeletonText,
  Slider,
  Sparkline,
  Spinner,
  StackedBar,
  Stat,
  Tabs,
  TextField,
  TierBadge,
  Toggle,
  useToast,
} from '../components/ds'
import { useThemePreference, type ThemePreference } from '../hooks/useTheme'
import { href } from '../router'
import styles from './Gallery.module.css'

const yuan = (major: number) => Math.round(major * 100)

const SPEND: { id: CategoryId; value: number; limit: number }[] = [
  { id: 'shopping', value: yuan(2310), limit: yuan(2000) },
  { id: 'dining', value: yuan(1240), limit: yuan(900) },
  { id: 'delivery', value: yuan(862.5), limit: yuan(600) },
  { id: 'coffee_tea', value: yuan(418), limit: yuan(450) },
  { id: 'transport', value: yuan(376), limit: yuan(500) },
]

const HISTORY = [yuan(8920), yuan(9840), yuan(9310), yuan(10420), yuan(9960), yuan(12240)]
const MONTHS = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

const AUTONOMY_STEPS: { value: Autonomy; label: string; hint: string }[] = [
  { value: 'observe', label: 'Observe', hint: 'Bun only reads and explains. It never proposes actions.' },
  { value: 'suggest', label: 'Suggest', hint: 'Bun proposes; every action waits for your tap.' },
  { value: 'copilot', label: 'Copilot', hint: 'Organising runs on its own; moving money needs a tap, paying needs your PIN.' },
  { value: 'autopilot', label: 'Autopilot', hint: 'Moves between your own pots within caps; paying still needs your PIN.' },
]

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{title}</h3>
        {note ? <p className={styles.groupNote}>{note}</p> : null}
      </header>
      <div className={styles.groupBody}>{children}</div>
    </section>
  )
}

function Row({ children, wrap = true }: { children: ReactNode; wrap?: boolean }) {
  return <div className={wrap ? styles.row : styles.rowNoWrap}>{children}</div>
}

const SWATCHES = ['bg', 'surface', 'surface-2', 'text', 'text-3', 'accent', 'over', 'under', 'warn', 'info'] as const

function TypeAndColour() {
  return (
    <Group title="Type & colour" note="Fraunces (soft) for headlines and display numbers · DM Sans for UI">
      <div className={styles.typeSample}>
        <p className={styles.eyebrow}>Dream Mirror · October</p>
        <p className={styles.headline}>You could’ve gotten a Weekend in Chengdu.</p>
        <p className={styles.body}>You’re ¥2,740 over your ¥9,500 target — and your Birkin just moved 5 weeks further away.</p>
      </div>
      <div className={styles.swatches}>
        {SWATCHES.map((t) => (
          <span key={t} className={styles.swatch}>
            <span className={styles.swatchChip} style={{ background: `var(--${t})` }} />
            <code>--{t}</code>
          </span>
        ))}
      </div>
    </Group>
  )
}

function Buttons() {
  const [loading, setLoading] = useState(false)
  return (
    <Group title="Buttons" note="Verb-first labels, ≥ 44px targets, loading keeps width">
      <Row>
        <Button>Stash ¥620 in MacBook</Button>
        <Button variant="secondary">See why</Button>
      </Row>
      <Row>
        <Button variant="soft" iconStart={<Sparkles />}>Treat yourself</Button>
        <Button variant="ghost">Not now</Button>
        <Button variant="danger" iconStart={<Trash2 />}>Delete data</Button>
      </Row>
      <Row>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Row>
      <Row>
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true)
            setTimeout(() => setLoading(false), 1600)
          }}
        >
          {loading ? 'Moving…' : 'Move ¥300 to Birkin'}
        </Button>
        <Button disabled>Disabled</Button>
      </Row>
      <Row>
        <IconButton label="Settings" icon={<Settings />} />
        <IconButton label="Notifications" icon={<Bell />} variant="secondary" badge={3} />
        <IconButton label="Add dream" icon={<Plus />} variant="primary" />
        <IconButton label="Activity" icon={<CalendarClock />} variant="glass" badge />
        <IconButton label="Send" icon={<Send />} size="sm" variant="secondary" />
      </Row>
    </Group>
  )
}

function BadgesAndChips() {
  const [filter, setFilter] = useState('month')
  const [tags, setTags] = useState(['Late night', 'Delivery'])
  return (
    <Group title="Badges & chips" note="Permission tiers warm with risk; AI label on every agent message">
      <Row>
        <Badge>Neutral</Badge>
        <Badge variant="accent">Goal</Badge>
        <Badge variant="under">Under target</Badge>
        <Badge variant="over">Over target</Badge>
        <Badge variant="warn">Due in 3 days</Badge>
        <Badge variant="info">New</Badge>
        <Badge variant="solid">Sandbox</Badge>
      </Row>
      <Row>
        <AiBadge />
        <AiBadge engine="offline" />
        <AiBadge engine="llm" size="md" />
      </Row>
      <Row>
        {([0, 1, 2, 3, 4] as Tier[]).map((t) => <TierBadge key={t} tier={t} />)}
      </Row>
      <Row>
        <Chip onClick={() => undefined} icon={<Sparkles />} tone="ai">Why am I over?</Chip>
        <Chip onClick={() => undefined}>Show subscriptions</Chip>
      </Row>
      <Row>
        {['week', 'month', 'year'].map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>This {f}</Chip>
        ))}
      </Row>
      <Row>
        <Chip size="sm" tone="over">Dining ¥1,240 vs ¥900</Chip>
        <Chip size="sm" tone="under">Coffee −7%</Chip>
        {tags.map((t) => (
          <Chip key={t} size="sm" onRemove={() => setTags(tags.filter((x) => x !== t))}>{t}</Chip>
        ))}
      </Row>
    </Group>
  )
}

function MoneyShowcase() {
  return (
    <Group title="Money" note="Integer fen in, money.fmt out; full amount spoken to screen readers">
      <div className={styles.moneyHero}>
        <span className={styles.caption}>Spent this month</span>
        <Money amount={yuan(12240.5)} size="hero" />
      </div>
      <Row>
        <Money amount={yuan(9500)} size="xl" />
        <Money amount={yuan(620)} size="lg" tone="under" signed />
        <Money amount={-yuan(1299)} size="lg" tone="sign" />
      </Row>
      <Row>
        <Money amount={yuan(18500)} signed tone="gain" />
        <Money amount={-yuan(45.8)} tone="sign" />
        <Money amount={yuan(98000)} compact />
        <Money amount={yuan(30)} tone="muted" />
        <Money amount={yuan(25)} strike />
        <Money amount={150000} currency="USD" />
      </Row>
    </Group>
  )
}

function Cards() {
  return (
    <Group title="Cards">
      <Card>
        <CardHeader title="iQIYI went up" subtitle="¥25 → ¥30 since August" icon={<ArrowLeftRight />} action={<AiBadge engine="offline" />} />
        <p className={styles.small}>That’s ¥60 a year. You also pay for Tencent Video and Youku — three video services.</p>
      </Card>
      <div className={styles.cardGrid}>
        <Card variant="over" padding="sm">
          <p className={styles.caption}>Over target</p>
          <Money amount={yuan(2740)} size="lg" tone="over" />
        </Card>
        <Card variant="under" padding="sm">
          <p className={styles.caption}>Under target</p>
          <Money amount={yuan(640)} size="lg" tone="under" />
        </Card>
        <Card variant="accent" padding="sm">
          <p className={styles.caption}>Safe to spend today</p>
          <Money amount={yuan(186)} size="lg" />
        </Card>
        <Card variant="sunken" padding="sm">
          <p className={styles.caption}>Sunken</p>
          <p className={styles.small}>Secondary surface</p>
        </Card>
      </div>
      <Card variant="glass">
        <p className={styles.small}>Glass card — sits over imagery and the steam layer.</p>
      </Card>
    </Group>
  )
}

function Lists() {
  return (
    <Group title="List items">
      <List card>
        <ListItem leading="🧋" title="Heytea" subtitle="Coffee & milk tea · WeChat Pay" trailing={<Money amount={-yuan(28)} />} meta="Today 15:42" />
        <ListItem leading="🛵" title="Meituan" subtitle="Food delivery · late night" trailing={<Money amount={-yuan(67.5)} />} meta="Oct 21 · 00:48" onClick={() => undefined} />
        <ListItem leading="💰" title="Salary" subtitle="Income" trailing={<Money amount={yuan(18500)} signed tone="gain" />} meta="Oct 10" />
        <ListItem leading={<Wallet />} title="Birkin pot" subtitle="Goal savings" trailing={<Money amount={yuan(23400)} />} href={href('goals')} />
      </List>
    </Group>
  )
}

function Stats() {
  return (
    <Group title="Stats">
      <div className={styles.statGrid}>
        <Card padding="sm">
          <Stat label="Spent" value={<Money amount={yuan(12240)} size="lg" />} delta={{ label: '+23% vs Sep', direction: 'up', good: false }} trend={HISTORY} trendLabel="Monthly spending, May to October" />
        </Card>
        <Card padding="sm">
          <Stat label="Daily average" value={<Money amount={yuan(556)} size="lg" />} delta={{ label: '−4% vs Sep', direction: 'down', good: true }} />
        </Card>
        <Card padding="sm">
          <Stat label="Saved to goals" icon={<Coffee />} value={<Money amount={yuan(2200)} size="lg" />} delta={{ label: 'same as Sep', direction: 'flat' }} hint="3 pots" />
        </Card>
      </div>
    </Group>
  )
}

function Progress() {
  return (
    <Group title="Progress" note="Over-budget fills are hatched so it never relies on colour alone">
      <ProgressBar label="Coffee & milk tea" value={418} max={450} tone="budget" valueLabel="¥418 / ¥450" />
      <ProgressBar label="Month to date" value={12240} max={9500} tone="budget" valueLabel="¥12,240 / ¥9,500" markers={[{ value: 6742, label: 'pace' }]} />
      <ProgressBar label="MacBook Air" value={46} tone="under" valueLabel="46%" size="lg" />
      <Row>
        <ProgressRing value={46} label="MacBook Air saved" tone="under">
          <span className={styles.ringValue}>46%</span>
          <span className={styles.ringCaption}>saved</span>
        </ProgressRing>
        <ProgressRing value={23400} max={98000} size={120} thickness={12} label="Birkin saved" valueText="24% of ¥98,000">
          <DreamImage image="preset:bag" alt="" size={64} />
        </ProgressRing>
        <ProgressRing value={129} max={100} size={88} thickness={8} tone="budget" label="Month spent">
          <span className={styles.ringSmall}>129%</span>
        </ProgressRing>
      </Row>
    </Group>
  )
}

function Controls() {
  const [tone, setTone] = useState<Tone>('gentle')
  const [glass, setGlass] = useState(true)
  const [notify, setNotify] = useState(false)
  const [autonomy, setAutonomy] = useState<Autonomy>('copilot')
  const [tab, setTab] = useState('month')
  const [amount, setAmount] = useState('300')
  const [consent, setConsent] = useState(false)
  return (
    <Group title="Controls">
      <Segmented<Tone>
        label="Bun’s tone"
        value={tone}
        onChange={setTone}
        options={[
          { value: 'gentle', label: 'Gentle' },
          { value: 'cheeky', label: 'Cheeky' },
          { value: 'numbers', label: 'Just numbers' },
        ]}
      />
      <div>
        <Toggle checked={glass} onChange={setGlass} label="Show the glass box" description="Live agent trace, policy decisions and the audit chain." />
        <Toggle checked={notify} onChange={setNotify} label="Tripwire reminders" description="Nudges with your dream picture when a threshold trips." tone="accent" />
      </div>
      <Slider<Autonomy> label="Autonomy" steps={AUTONOMY_STEPS} value={autonomy} onChange={setAutonomy} risk />
      <Tabs
        label="Period"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'month', label: 'This month', content: <p className={styles.small}>Oct 1 – 22 · 22 of 31 days</p> },
          { id: 'last', label: 'Last month', content: <p className={styles.small}>September · closed</p> },
          { id: 'six', label: '6 months', badge: 6, content: <p className={styles.small}>May – October</p> },
        ]}
      />
      <Tabs
        label="Bills filter"
        variant="pill"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'month', label: 'Upcoming', badge: 3 },
          { id: 'last', label: 'Paid' },
          { id: 'six', label: 'Findings' },
        ]}
      />
      <TextField label="Amount" prefix="¥" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} hint="Moves from Checking to your Birkin pot" />
      <TextField label="Single purchase over" prefix="¥" defaultValue="1,299x" error="Enter an amount like 1299" />
      <TextField label="Paste a bill" multiline placeholder="Paste the text of a bill — Bun treats it as data, never instructions" />
      <Checkbox checked={consent} onChange={setConsent} label="Use my financial data to give me insights" description="Separate consent (PIPL Art. 29). You can withdraw it in Settings." />
    </Group>
  )
}

function PinShowcase() {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  return (
    <Group title="PIN pad" note="Type digits on the keyboard too. Odd attempts fail (shake), even attempts pass.">
      <PinPad
        length={4}
        autoFocus={false}
        label="Confirm with your PIN"
        description="Move ¥300 to Birkin pot"
        error={error}
        errorKey={attempt}
        onComplete={() => {
          const next = attempt + 1
          setAttempt(next)
          if (next % 2 === 1) setError('That PIN didn’t match. 4 tries left.')
          else {
            setError(null)
            toast.show({ tone: 'success', title: 'Approved', message: 'Gallery demo — nothing moved.' })
          }
        }}
      />
    </Group>
  )
}

function Feedback() {
  return (
    <Group title="Feedback">
      <Callout tone="info" title="Why am I seeing this?">Dining is ¥340 over its ¥900 limit, 9 days before month-end.</Callout>
      <Callout tone="warn" title="Electricity bill is 57% above usual">¥486.20 due Oct 28 · 3-period average ¥309.</Callout>
      <Callout tone="block" title="Blocked: transfer to an unknown account">The bill text asked an AI to send ¥4,800. That’s a T4 action — never allowed.</Callout>
      <Callout tone="safe" title="Audit chain verified">212 entries, unbroken.</Callout>
      <Card padding="none">
        <EmptyState compact title="No bills due" body="Bun will nudge you three days before anything is due." mood="happy" />
      </Card>
      <div className={styles.skeletonRow} aria-busy="true">
        <Skeleton shape="circle" width={40} />
        <SkeletonText lines={2} />
      </div>
      <Row>
        <Spinner />
        <span className={styles.small}>Bun is thinking…</span>
      </Row>
    </Group>
  )
}

function Charts() {
  const bars = SPEND.map((s) => ({ id: s.id, label: CATEGORIES[s.id].label, value: s.value, limit: s.limit, icon: CATEGORIES[s.id].emoji }))
  const donut = SPEND.map((s) => ({ id: s.id, label: CATEGORIES[s.id].label, value: s.value, color: CATEGORIES[s.id].color }))
  return (
    <Group title="Charts" note="role=img summaries + hidden data tables; one shared scale; text never wears series colour">
      <Card>
        <CardHeader title="October by category" subtitle="Spent vs limit" />
        <BarChart data={bars} label="October spending by category against limits" />
      </Card>
      <Card>
        <CardHeader title="Last 6 months" subtitle="Line = spending · rule = ¥9,500 target" />
        <Sparkline values={HISTORY} labels={MONTHS} label="Monthly spending, May to October" reference={yuan(9500)} referenceLabel="Target" height={64} />
      </Card>
      <Card>
        <CardHeader title="Where it went" />
        <Donut data={donut} label="October spending split">
          <span className={styles.caption}>Total</span>
          <Money amount={SPEND.reduce((s, d) => s + d.value, 0)} size="lg" compact />
        </Donut>
      </Card>
      <Card>
        <CardHeader title="Needs · wants · savings" subtitle="Against the ¥9,500 target" />
        <StackedBar
          label="October needs, wants and savings"
          data={[
            { id: 'needs', label: 'Needs', value: yuan(5410) },
            { id: 'wants', label: 'Wants', value: yuan(4830) },
            { id: 'save', label: 'Savings', value: yuan(2200) },
          ]}
          markers={[{ value: yuan(9500), label: 'target' }]}
        />
      </Card>
    </Group>
  )
}

function Overlays() {
  const toast = useToast()
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  return (
    <Group title="Overlays" note="Sheets, dialogs and toasts render in the app’s root theme">
      <Row>
        <Button variant="secondary" onClick={() => setSheet(true)}>Open action sheet</Button>
        <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
      </Row>
      <Row>
        <Button
          variant="secondary"
          onClick={() =>
            toast.show({
              title: 'That ¥1,299 = 1.3% of your Birkin',
              message: 'Single purchase over ¥1,000 tripwire.',
              image: <DreamImage image="preset:bag" alt="" size={52} />,
              actions: [
                { label: 'Stash ¥100 instead', onClick: () => undefined, variant: 'primary' },
                { label: 'Dismiss', onClick: () => undefined },
              ],
            })
          }
        >
          Tripwire toast
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.show({
              id: 'undo',
              tone: 'success',
              title: 'Moved ¥300 to Birkin pot',
              message: 'You can undo for 10 seconds.',
              icon: <Undo2 />,
              duration: 10000,
              showProgress: true,
              actions: [{ label: 'Undo', onClick: () => undefined }],
            })
          }
        >
          Undo toast
        </Button>
      </Row>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Move ¥300 to Birkin pot"
        description="Proposed by Bun · Checking •••• 4821 → Birkin pot"
        media={<DreamImage image="preset:bag" alt="" size={48} />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSheet(false)}>Not now</Button>
            <Button onClick={() => setSheet(false)}>Move ¥300</Button>
          </>
        }
      >
        <div className={styles.sheetBody}>
          <Row>
            <TierBadge tier={2} />
            <Badge variant="under">Reversible · 10 s undo</Badge>
            <AiBadge engine="offline" />
          </Row>
          <ul className={styles.effects}>
            <li>Checking balance ¥6,180 → ¥5,880</li>
            <li>Birkin pot ¥23,400 → ¥23,700 (24.2%)</li>
            <li>Within your ¥500 per-action cap</li>
          </ul>
        </div>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        alert
        tone="danger"
        media={<BunMascot size={72} mood="worried" />}
        title="Delete all FundBun data?"
        description="Transactions, dreams and the audit log on this device will be wiped. This can’t be undone."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>Keep my data</Button>
            <Button variant="danger" onClick={() => setDialog(false)}>Delete everything</Button>
          </>
        }
      />
    </Group>
  )
}

function Showcase() {
  return (
    <div className={styles.showcase}>
      <TypeAndColour />
      <Buttons />
      <BadgesAndChips />
      <MoneyShowcase />
      <Cards />
      <Lists />
      <Stats />
      <Progress />
      <Charts />
      <Controls />
      <PinShowcase />
      <Feedback />
      <Overlays />
    </div>
  )
}

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'dark', label: 'Dark', icon: <Moon /> },
]

export default function Gallery() {
  const [theme, setTheme] = useThemePreference()
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Logo size={40} withWordmark />
          <div>
            <h1 className={styles.title}>Design system</h1>
            <p className={styles.subtitle}>The steamer palette — every component, light and dark, with fake data.</p>
          </div>
        </div>
        <div className={styles.headerTools}>
          <Segmented<ThemePreference> label="App theme" size="sm" value={theme} onChange={setTheme} options={THEME_OPTIONS} />
          <Button variant="ghost" size="sm" href={href('home')}>Back to the app</Button>
        </div>
      </header>
      <SectionHeader eyebrow="Visual QA" title="Light and dark, side by side" className={styles.sectionHead} />
      <div className={styles.columns}>
        <section data-theme="light" className={styles.pane} aria-label="Light theme">
          <p className={styles.paneLabel}><Sun aria-hidden="true" /> Light</p>
          <Showcase />
        </section>
        <section data-theme="dark" className={styles.pane} aria-label="Dark theme">
          <p className={styles.paneLabel}><Moon aria-hidden="true" /> Dark</p>
          <Showcase />
        </section>
      </div>
    </div>
  )
}
