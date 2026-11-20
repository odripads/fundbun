import { ArrowRight, BellRing, Check, CircleCheck, CircleHelp, Clock3, Flame, FlaskConical, Gauge, MessageCircleHeart, PiggyBank, ShieldCheck, Sparkles, Target, Thermometer, ThermometerSnowflake, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import type { AppSnapshot } from '../../../core/app-api'
import { dateLabel } from '../../../core/dates'
import type { Minor, MirrorStatus, SuggestedAction } from '../../../core/types'
import { suggestionReceipt, useProposeAction } from '../../components/agent'
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
  shortName,
  splitHeadline,
  stashAmount,
  type CtaIcon,
  type StatusTone,
  temperLine,
  isAngry,
  shout,
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
  /** open the daily-amount sheet */
  onPlan?: () => void
}

const selectPending = (s: AppSnapshot) => s.state.pending

const selectHero = (s: AppSnapshot) => ({
  mirror: s.derived.mirror,
  currency: s.state.profile?.currency ?? 'CNY',
  dreams: s.state.dreams,
})

// the icon says good or bad at a glance: a tick for the good state, a warning for the bad one (an arrow going
// "up" for overspending, or "down" for doing well, reads the wrong way round)
const STATUS_ICON: Record<MirrorStatus, LucideIcon> = {
  over: TriangleAlert,
  pace_over: Gauge,
  on_track: Target,
  under: CircleCheck,
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

/** The glass is drawn in a 100 × 114 frame; the blow landed up and to the right of centre. */
const CRACK_RAYS = [
  'M63 43L71 30L69 18L76 4L74 0',
  'M63 43L78 40L88 46L100 42',
  'M63 43L70 56L82 66L88 84L100 92',
  'M63 43L55 58L58 74L48 92L52 114',
  'M63 43L47 45L36 38L20 44L0 38',
  'M63 43L52 31L38 26L30 12L18 4',
]
const CRACK_WEB = ['M71 30L78 40L70 56L55 58L47 45L52 31Z']
/** Furious: the glass is shattered, not just cracked. */
const SHATTER_RAYS = ['M63 43L66 62L60 80L66 100L62 114', 'M63 43L80 52L92 62L100 70', 'M63 43L58 22L62 8L56 0', 'M63 43L44 54L30 66L14 70L0 80', 'M63 43L84 30L92 16L100 10']
const SHATTER_WEB = ['M69 18L84 30L88 46L92 62L82 66L60 80L58 74L30 66L36 38L38 26L58 22Z']
const SHARDS = ['M63 43L78 40L70 56Z', 'M63 43L47 45L55 58Z', 'M88 46L92 62L82 66Z']

/**
 * The mirror breaks when Bun is angry: fractures run out from one blow, and when Bun is furious the glass is
 * shattered. Drawn in code, each line twice (a shadow under a bright edge) so it reads as broken glass.
 */
function Cracks({ shattered }: { shattered: boolean }) {
  const rays = shattered ? [...CRACK_RAYS, ...SHATTER_RAYS] : CRACK_RAYS
  const web = shattered ? [...CRACK_WEB, ...SHATTER_WEB] : CRACK_WEB
  return (
    <span className={styles.cracks} aria-hidden="true">
      <svg viewBox="0 0 100 114" preserveAspectRatio="none" focusable="false">
        {shattered ? SHARDS.map((d, i) => <path key={d} d={d} className={i === 1 ? styles.shardDark : styles.shard} />) : null}
        <g className={styles.crackShadow} transform="translate(0.7 0.9)">
          {rays.map((d) => (
            <path key={d} d={d} pathLength={1} />
          ))}
        </g>
        <g className={styles.crackEdge}>
          {rays.map((d) => (
            <path key={d} d={d} pathLength={1} />
          ))}
          {web.map((d) => (
            <path key={d} d={d} pathLength={1} className={styles.web} />
          ))}
        </g>
      </svg>
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
/** The demo personas run on a simulated bank and a frozen calendar; a user's own data has neither. */
const selectSandboxDate = (s: AppSnapshot): string | null => (s.derived.clock === 'sandbox' ? dateLabel(s.derived.today) : null)

export function MirrorHero({ onCheck, onSandbox, onPlan }: MirrorHeroProps) {
  const app = useApp()
  const { mirror, currency, dreams } = useSnapshot(selectHero, shallowEqual)
  const propose = useProposeAction()
  const headingId = useId()
  const [why, setWhy] = useState(false)
  const [busy, setBusy] = useState<'primary' | 'secondary' | null>(null)
  // what each button proposed: once it ran, the button becomes a receipt of what ran (undo brings it back)
  const [pids, setPids] = useState<{ primary?: string; secondary?: string }>({})
  const pending = useSnapshot(selectPending)
  const sandboxDate = useSnapshot(selectSandboxDate)

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
  // Bun is angry: the mirror breaks, the dream goes dark and the words are shouted (see "the broken mirror" in the stylesheet)
  const broken = isAngry(mirror.mood)
  const headline = broken ? shout(mirror.headline) : mirror.headline
  const subline = broken ? shout(mirror.subline) : mirror.subline
  const parts = splitHeadline(headline, hero.item?.name)
  const stats = mirrorStats(mirror, currency)
  const actions = heroActions(mirror, dreams)
  const noData = mirror.status === 'no_data'
  const temper = temperLine(mirror)
  const losing = mirror.status === 'over' || mirror.status === 'pace_over'
  const goalNow = mirror.goal ? mirror.goal.pct : 0
  const goalAfter = mirror.goal ? pctAfter(mirror.goal, stashAmount(mirror.cta)) : 0

  const plate = hero.item
    ? {
        name: shortName(hero.item.name),
        full: hero.item.name,
        detail: hero.role === 'goal' && mirror.goal ? `${Math.floor(goalNow)}% saved` : fmtWhole(hero.item.price, currency),
      }
    : null

  async function run(action: SuggestedAction, which: 'primary' | 'secondary') {
    setBusy(which)
    try {
      const p = await propose(action)
      if (p) setPids((x) => ({ ...x, [which]: p.id }))
    } finally {
      setBusy(null)
    }
  }

  function receiptFor(a: HeroAction, which: 'primary' | 'secondary') {
    if (a.kind !== 'action') return undefined
    const p = suggestionReceipt(pending, a.action, pids[which])
    return p && p.status === 'executed' && p.decision.tier > 0 ? p : undefined
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
      const receipt = receiptFor(a, which)
      if (receipt) {
        return (
          <p className={styles.done} role="status">
            <Check aria-hidden="true" />
            <span>
              <strong>Done</strong> · {receipt.preview.title}
            </span>
          </p>
        )
      }
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
        {a.kind === 'prompt' ? 'Bun lines up fixes — money never moves without your OK.' : ctaHint(a.action, sandboxDate !== null)}
      </p>
    )
  }

  return (
    <section className={styles.hero} data-status={mirror.status} data-mood={mirror.mood} aria-labelledby={headingId}>
      <Ambient />

      {/* a demo persona's calendar is frozen: say the date, so "October" on a November stage is not a mystery */}
      <Chip size="sm" icon={<FlaskConical />} onClick={onSandbox} aria-label={sandboxDate ? 'Bank demo: open the demo controls' : 'Open the sandbox (demo controls)'} className={styles.sandbox}>
        {sandboxDate ? `Bank demo · ${sandboxDate}` : 'Sandbox'}
      </Chip>

      {/* the first view: everything up to the primary action, sized to the screen with the band under the tab bar
          and the raised "Ask Bun" button left empty (the second choice and the "why" chip start below it) */}
      <div className={styles.fold} data-temper={temper ? true : undefined}>
        <figure className={styles.stage} data-role={hero.role}>
          <div className={styles.mirrorWrap}>
            <Steam />
            <div className={styles.mirror}>
              <span className={styles.glass} aria-hidden="true" />
              <span className={styles.sheen} aria-hidden="true" />
              {hero.item ? (
                <span className={styles.float}>
                  {hero.role === 'goal' ? <GoalRing now={goalNow} after={goalAfter} /> : null}
                  <DreamImage image={hero.item.image} alt={hero.item.name} size={hero.role === 'goal' ? 118 : 136} glow={!noData} className={styles.dream} priority />
                </span>
              ) : (
                <span className={styles.float}>
                  <BunMascot mood={mirror.mood} size={132} title={`Bun looks ${mirror.mood}`} />
                </span>
              )}
              <span className={styles.floor} aria-hidden="true" />
              {broken ? <Cracks shattered={mirror.mood === 'furious'} /> : null}
            </div>
            {hero.item ? (
              <span className={styles.bun} data-mood={mirror.mood}>
                <BunMascot mood={mirror.mood} size={78} title={`Bun looks ${mirror.mood}`} />
              </span>
            ) : null}
          </div>
          {plate ? (
            <figcaption className={styles.plate}>
              <span className={styles.plateName} title={plate.full !== plate.name ? plate.full : undefined}>{plate.name}</span>
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
          <h2 id={headingId} className={styles.headline} data-long={mirror.headline.length > 64 ? 'xl' : mirror.headline.length > 42 || undefined}>
            {parts ? (
              <>
                {parts[0]}
                <em className={styles.itemName}>{parts[1]}</em>
                {parts[2]}
              </>
            ) : (
              headline
            )}
          </h2>
          <p className={styles.subline}>{subline}</p>
          {temper ? (
            <p className={styles.temper} data-kind={temper.kind}>
              {temper.kind === 'carrot' ? <Flame aria-hidden="true" /> : temper.kind === 'cooling' ? <ThermometerSnowflake aria-hidden="true" /> : <Thermometer aria-hidden="true" />}
              <span>
                <strong>{temper.label}{temper.kind === 'stick' && broken ? '!!!' : '.'}</strong> {temper.text}
                {temper.plan && onPlan ? (
                  <>
                    {' '}
                    <button type="button" className={styles.temperAction} onClick={onPlan}>
                      {temper.plan === 'set' ? 'Set a daily amount you can live with' : 'Change my daily amount'}
                    </button>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
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
              <p className={styles.hint}>Or import a statement file in Bills — it stays on this device.</p>
            </>
          ) : null}
        </div>
      </div>

      {actions.secondary ? (
        <div className={styles.secondary} data-kind={actions.secondary.kind}>
          {actions.primary && actions.secondary.kind === 'action' ? <span className={styles.or} aria-hidden="true">or</span> : null}
          {heroButton(actions.secondary, 'secondary')}
          {actions.primary?.kind === 'prompt' ? heroHint(actions.secondary) : null}
        </div>
      ) : null}

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
