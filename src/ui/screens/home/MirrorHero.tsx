import { ArrowRight, BellRing, CircleHelp, Clock3, FlaskConical, Gauge, MessageCircleHeart, PiggyBank, ShieldCheck, Sparkles, Target, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import type { Minor, MirrorStatus, SuggestedAction } from '../../../core/types'
import { useProposeAction } from '../../components/agent'
import { BunMascot, DreamImage } from '../../components/brand'
import { AiBadge, Badge, Button, Chip, Sheet, cx, type BadgeVariant } from '../../components/ds'
import { navigate } from '../../router'
import { shallowEqual, useApp, useSnapshot } from '../../state'
import { MirrorWhy } from './MirrorWhy'
import {
  STATUS_META,
  ctaHint,
  ctaIcon,
  fmtWhole,
  heroActions,
  heroDream,
  type HeroAction,
  mirrorEyebrow,
  mirrorStats,
  pctAfter,
  splitHeadline,
  stashAmount,
  type CtaIcon,
  type StatusTone,
} from './model'
import styles from './MirrorHero.module.css'

export interface CheckRequest {
  amount: Minor
  label: string
}

export interface MirrorHeroProps {
  /** open the "Should I buy it?" sheet for an amount (the treat button uses it) */
  onCheck: (req: CheckRequest) => void
  onSandbox: () => void
}

const selectHero = (s: AppSnapshot) => ({
  mirror: s.derived.mirror,
  currency: s.state.profile?.currency ?? 'CNY',
  dreams: s.state.dreams,
})

const STATUS_ICON: Record<MirrorStatus, LucideIcon> = {
  over: TrendingUp,
  pace_over: Gauge,
  on_track: Target,
  under: TrendingDown,
  no_data: Clock3,
}

const CTA_ICON: Record<CtaIcon, ReactNode> = {
  bell: <BellRing />,
  gauge: <Gauge />,
  piggy: <PiggyBank />,
  spark: <Sparkles />,
}

const BADGE: Record<StatusTone, BadgeVariant> = {
  over: 'over',
  warn: 'warn',
  under: 'under',
  accent: 'accent',
  neutral: 'neutral',
}

/** Decorative layers: status-tinted glow, drifting orbs and steam rising off the mirror. */
function Ambient() {
  return (
    <div className={styles.ambient} aria-hidden="true">
      <span className={cx(styles.orb, styles.orbA)} />
      <span className={cx(styles.orb, styles.orbB)} />
      <span className={cx(styles.orb, styles.orbC)} />
      <span className={styles.grain} />
    </div>
  )
}

function Steam() {
  return (
    <span className={styles.steam} aria-hidden="true">
      <span className={cx(styles.wisp, styles.wispA)} />
      <span className={cx(styles.wisp, styles.wispB)} />
      <span className={cx(styles.wisp, styles.wispC)} />
    </span>
  )
}

/** Goal progress around the dream: the solid arc is saved today, the faint arc is where a stash would take it. */
function GoalRing({ now, after }: { now: number; after: number }) {
  const size = 200
  const stroke = 7
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = (pct: number) => ({ strokeDasharray: `${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}` })
  return (
    <svg className={styles.ring} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className={styles.ringTrack} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
      {after > now ? <circle className={styles.ringAfter} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} style={arc(after)} /> : null}
      <circle className={styles.ringNow} cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} style={arc(now)} />
    </svg>
  )
}

/**
 * The Dream Mirror — FundBun's signature hero. The month is reflected back as one of the user's own dream
 * items inside an arched vanity mirror, with Bun reacting beside it. All copy and numbers come from
 * derived.mirror (computed on-device); every action goes through the policy engine via useProposeAction.
 */
export function MirrorHero({ onCheck, onSandbox }: MirrorHeroProps) {
  const app = useApp()
  const { mirror, currency, dreams } = useSnapshot(selectHero, shallowEqual)
  const propose = useProposeAction()
  const headingId = useId()
  const [why, setWhy] = useState(false)
  const [busy, setBusy] = useState<'primary' | 'secondary' | null>(null)

  if (!mirror) {
    return (
      <section className={styles.hero} data-status="no_data" aria-labelledby={headingId}>
        <Ambient />
        <div className={styles.fallback}>
          <BunMascot mood="sleepy" size={128} />
          <h2 id={headingId} className={styles.headline}>Bun is still waking up</h2>
          <p className={styles.subline}>Your month couldn’t be read just now. Try the sandbox, or come back in a moment.</p>
          <Button variant="secondary" iconStart={<FlaskConical />} onClick={onSandbox}>Open the sandbox</Button>
        </div>
      </section>
    )
  }

  const meta = STATUS_META[mirror.status]
  const StatusIcon = STATUS_ICON[mirror.status]
  const hero = heroDream(mirror, dreams)
  const parts = splitHeadline(mirror.headline, hero.item?.name)
  const stats = mirrorStats(mirror, currency)
  const actions = heroActions(mirror, dreams)
  const noData = mirror.status === 'no_data'
  const losing = mirror.status === 'over' || mirror.status === 'pace_over'
  const goalNow = mirror.goal ? mirror.goal.pct : 0
  const goalAfter = mirror.goal ? pctAfter(mirror.goal, stashAmount(mirror.cta)) : 0

  const plate = hero.item
    ? {
        name: hero.item.name,
        detail: hero.role === 'goal' && mirror.goal ? `${Math.floor(goalNow)}% saved` : fmtWhole(hero.item.price, currency),
      }
    : null

  async function run(action: SuggestedAction, which: 'primary' | 'secondary') {
    setBusy(which)
    try {
      await propose(action)
    } finally {
      setBusy(null)
    }
  }

  function askBun(text: string) {
    void app.sendMessage(text).catch(() => undefined)
    navigate('chat')
  }

  function act(a: HeroAction, which: 'primary' | 'secondary') {
    if (a.kind === 'prompt') askBun(a.prompt)
    else if (a.kind === 'action') void run(a.action, which)
    else onCheck({ amount: a.amount, label: dreams.find((d) => d.id === a.itemId)?.name ?? 'this' })
  }

  function heroButton(a: HeroAction, which: 'primary' | 'secondary') {
    const primary = which === 'primary'
    if (a.kind === 'prompt') {
      return (
        <Button size="lg" fullWidth iconStart={<MessageCircleHeart />} iconEnd={<ArrowRight />} onClick={() => act(a, which)}>
          {a.label}
        </Button>
      )
    }
    if (a.kind === 'action') {
      return (
        <Button
          size={primary ? 'lg' : 'md'}
          variant={primary ? 'primary' : 'secondary'}
          fullWidth
          iconStart={CTA_ICON[ctaIcon(a.action)]}
          loading={busy === which}
          onClick={() => act(a, which)}
        >
          {a.action.label}
        </Button>
      )
    }
    const item = dreams.find((d) => d.id === a.itemId)
    return (
      <Button variant="ghost" fullWidth iconStart={item ? <DreamImage image={item.image} alt="" size={28} /> : undefined} onClick={() => act(a, which)}>
        {a.label}
      </Button>
    )
  }

  function heroHint(a: HeroAction) {
    if (a.kind === 'check') return null
    return (
      <p className={styles.hint}>
        {a.kind === 'prompt' ? <Sparkles aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
        {a.kind === 'prompt' ? 'Bun lines up fixes — nothing changes without your OK.' : ctaHint(a.action)}
      </p>
    )
  }

  return (
    <section className={styles.hero} data-status={mirror.status} aria-labelledby={headingId}>
      <Ambient />

      <Chip size="sm" icon={<FlaskConical />} onClick={onSandbox} aria-label="Open the sandbox (demo controls)" className={styles.sandbox}>
        Sandbox
      </Chip>

      <figure className={styles.stage} data-role={hero.role}>
        <div className={styles.mirrorWrap}>
          <Steam />
          <div className={styles.mirror}>
            <span className={styles.glass} aria-hidden="true" />
            <span className={styles.sheen} aria-hidden="true" />
            {hero.item ? (
              <span className={styles.float}>
                {hero.role === 'goal' ? <GoalRing now={goalNow} after={goalAfter} /> : null}
                <DreamImage image={hero.item.image} alt={hero.item.name} size={hero.role === 'goal' ? 118 : 136} glow={!noData} className={styles.dream} />
              </span>
            ) : (
              <span className={styles.float}>
                <BunMascot mood={mirror.mood} size={132} title={`Bun looks ${mirror.mood}`} />
              </span>
            )}
            <span className={styles.floor} aria-hidden="true" />
          </div>
          {hero.item ? (
            <span className={styles.bun} data-mood={mirror.mood}>
              <BunMascot mood={mirror.mood} size={78} title={`Bun looks ${mirror.mood}`} />
            </span>
          ) : null}
        </div>
        {plate ? (
          <figcaption className={styles.plate}>
            <span className={styles.plateName}>{plate.name}</span>
            <span className={styles.plateDot} aria-hidden="true">·</span>
            <span className={styles.plateDetail}>{plate.detail}</span>
          </figcaption>
        ) : null}
      </figure>

      <div className={styles.copy}>
        <div className={styles.eyebrowRow}>
          <p className={styles.eyebrow}>{mirrorEyebrow(mirror)}</p>
          <Badge size="sm" variant={BADGE[meta.tone]} icon={<StatusIcon />}>{meta.label}</Badge>
        </div>
        <h2 id={headingId} className={styles.headline} data-long={mirror.headline.length > 42 || undefined}>
          {parts ? (
            <>
              {parts[0]}
              <em className={styles.itemName}>{parts[1]}</em>
              {parts[2]}
            </>
          ) : (
            mirror.headline
          )}
        </h2>
        <p className={styles.subline}>{mirror.subline}</p>
      </div>

      {stats.length > 0 ? (
        <ul className={styles.stats} aria-label="The numbers behind it" style={{ '--cols': stats.length } as CSSProperties}>
          {stats.map((s, i) => (
            <li key={s.id} className={styles.stat} data-tone={s.tone} style={{ '--i': i } as CSSProperties}>
              <span className={styles.statValue} aria-hidden="true">{s.value}</span>
              <span className={styles.statLabel} aria-hidden="true">{s.label}</span>
              <span className="sr-only">{s.description}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.actions}>
        {actions.primary ? (
          <>
            {heroButton(actions.primary, 'primary')}
            {heroHint(actions.primary)}
          </>
        ) : noData ? (
          <>
            <Button size="lg" fullWidth iconStart={<FlaskConical />} onClick={onSandbox}>
              Try a sandbox purchase
            </Button>
            <p className={styles.hint}>Or import a bank CSV in Settings — it stays on this device.</p>
          </>
        ) : null}
        {actions.secondary ? (
          <div className={styles.secondary} data-kind={actions.secondary.kind}>
            {actions.primary && actions.secondary.kind === 'action' ? <span className={styles.or} aria-hidden="true">or</span> : null}
            {heroButton(actions.secondary, 'secondary')}
            {actions.primary?.kind === 'prompt' ? heroHint(actions.secondary) : null}
          </div>
        ) : null}
      </div>

      <div className={styles.meta}>
        <Chip tone="ai" icon={<CircleHelp />} onClick={() => setWhy(true)}>
          Why am I seeing this?
        </Chip>
        <AiBadge engine="offline" />
      </div>

      <Sheet
        open={why}
        onClose={() => setWhy(false)}
        title="Why am I seeing this?"
        description="How Bun built this month’s mirror from your own numbers — all on this device."
        media={hero.item ? <DreamImage image={hero.item.image} alt="" size={52} /> : <BunMascot mood={mirror.mood} size={52} />}
        footer={
          <>
            <Button
              variant="secondary"
              iconStart={<Sparkles />}
              onClick={() => {
                setWhy(false)
                askBun(losing ? 'Why am I over this month?' : 'How am I doing this month?')
              }}
            >
              Ask Bun
            </Button>
            <Button onClick={() => setWhy(false)}>Got it</Button>
          </>
        }
      >
        <MirrorWhy />
      </Sheet>
    </section>
  )
}
