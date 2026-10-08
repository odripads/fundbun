import { CalendarClock, CircleCheck, Clock3, Gauge, Hourglass, CirclePause, PiggyBank, Scale, Sparkles, Target, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import type { AppSnapshot } from '../../../../core/app-api'
import { monthLabel } from '../../../../core/dates'
import { delayShort } from '../../../../core/finance/copy'
import { fmt } from '../../../../core/money'
import type { AffordabilityResult, DreamItem, GoalProgress, MirrorStatus } from '../../../../core/types'
import { useSnapshot } from '../../../state'
import { BunMascot, DreamImage } from '../../brand'
import { Button, Card, CardHeader, Money, ProgressBar, ProgressRing, cx, type CardVariant } from '../../ds'
import { Disclosure } from '../Disclosure'
import { capitalize } from '../logic'
import { useProposeAction } from '../useProposeAction'
import { Eyebrow, useCurrency, type CardProps } from './shared'
import styles from './cards.module.css'

// ───────────────────────────── mirror ─────────────────────────────

const MIRROR_META: Record<MirrorStatus, { label: string; icon: LucideIcon; variant: CardVariant }> = {
  over: { label: 'Over target', icon: TrendingUp, variant: 'over' },
  pace_over: { label: 'On pace to go over', icon: Gauge, variant: 'accent' },
  on_track: { label: 'On track', icon: Target, variant: 'accent' },
  under: { label: 'Under target', icon: TrendingDown, variant: 'under' },
  no_data: { label: 'No data yet', icon: Clock3, variant: 'default' },
}

/** The Dream Mirror, pocket-sized: the user's own dream item framed in the arch, the month as a headline. */
export function MirrorCard({ card }: CardProps<'mirror'>) {
  const m = card.mirror
  const currency = useCurrency()
  const propose = useProposeAction()
  const meta = MIRROR_META[m.status]
  const Icon = meta.icon
  const over = m.status === 'over' || m.status === 'pace_over'
  return (
    <Card as="section" variant={meta.variant} padding="none" className={styles.mirror} data-status={m.status} aria-label={`Dream mirror: ${m.headline}`}>
      <div className={styles.mirrorTop}>
        <div className={styles.arch} aria-hidden={m.item ? undefined : true}>
          {m.item ? <DreamImage image={m.item.image} alt={m.item.name} size={72} glow className={styles.archImg} /> : <BunMascot mood={m.mood} size={60} />}
          <span className={styles.glint} aria-hidden="true" />
        </div>
        <div className={styles.mirrorText}>
          <p className={cx(styles.status, styles[`status-${m.status}`])}>
            <Icon aria-hidden="true" />
            {meta.label} · {monthLabel(m.month, 'short')}
          </p>
          <h3 className={styles.headline}>{m.headline}</h3>
        </div>
      </div>
      <div className={styles.mirrorBody}>
        <p className={styles.subline}>{m.subline}</p>
        <ProgressBar
          value={m.spent}
          max={m.target}
          tone="budget"
          size="sm"
          label="Spent so far"
          valueLabel={`${fmt(m.spent, currency)} of ${fmt(m.target, currency)}`}
          valueText={`${fmt(m.spent, currency)} of ${fmt(m.target, currency)} target`}
        />
        <ul className={styles.factRow}>
          {m.projected > 0 && m.status !== 'no_data' ? (
            <li><Gauge aria-hidden="true" />Heading for {fmt(m.projected, currency)}</li>
          ) : null}
          {m.hoursOfWork ? <li><Clock3 aria-hidden="true" />≈ {Math.round(m.hoursOfWork)} h of work</li> : null}
          {m.goal && m.goalDelayDays ? <li><CalendarClock aria-hidden="true" />{m.goal.name} +{delayShort(m.goalDelayDays)}</li> : null}
          {m.goal && !over ? <li><PiggyBank aria-hidden="true" />{m.goal.name} {Math.round(m.goal.pct)}% saved</li> : null}
        </ul>
        {m.cta ? (
          <Button size="sm" variant={over ? 'secondary' : 'primary'} iconStart={over ? <Sparkles /> : <PiggyBank />} onClick={() => void propose(m.cta!)} className={styles.cta}>
            {m.cta.label}
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

// ───────────────────────────── affordability ─────────────────────────────

const VERDICT: Record<AffordabilityResult['verdict'], { label: string; icon: LucideIcon; variant: CardVariant; tone: string }> = {
  go: { label: 'Fits your budget', icon: CircleCheck, variant: 'under', tone: 'under' },
  think: { label: 'Sleep on it', icon: Hourglass, variant: 'accent', tone: 'warn' },
  skip: { label: 'Not this month', icon: CirclePause, variant: 'over', tone: 'over' },
}

export function AffordabilityCard({ card }: CardProps<'affordability'>) {
  const r = card.result
  const currency = useCurrency()
  const v = VERDICT[r.verdict]
  const Icon = v.icon
  const sub = r.overTargetBy > 0
    ? `It would end the month ${fmt(r.overTargetBy, currency)} over your target.`
    : r.remainingAfter >= 0
      ? `You’d still have ${fmt(r.remainingAfter, currency)} of this month’s budget left.`
      : 'It eats into next month’s budget.'
  return (
    <Card as="section" variant={v.variant} className={styles.afford} aria-label={`Should I buy ${r.label}? ${v.label}`}>
      <Eyebrow icon={<Scale />}>Should I buy it?</Eyebrow>
      <div className={styles.affordHead}>
        <h3 className={styles.affordLabel}>{capitalize(r.label)}</h3>
        <Money amount={r.amount} currency={currency} size="lg" />
      </div>
      <div className={cx(styles.verdict, styles[`verdict-${v.tone}`])}>
        <Icon aria-hidden="true" />
        <div>
          <p className={styles.verdictLabel}>{v.label}</p>
          <p className={styles.verdictSub}>{sub}</p>
        </div>
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Work time</dt>
          <dd>{Math.round(r.hoursOfWork * 10) / 10} h</dd>
        </div>
        {r.goalName && r.goalDelayDays ? (
          <div>
            <dt>{r.goalName}</dt>
            <dd>+{r.delayText ?? delayShort(r.goalDelayDays)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Safe today</dt>
          <dd><Money amount={r.safeToSpendToday} currency={currency} size="sm" /></dd>
        </div>
      </dl>
      {r.equivalents.length ? (
        <div className={styles.equivWrap}>
          <p className={styles.minor}>The same money as</p>
          <ul className={styles.equivalents}>
            {r.equivalents.slice(0, 3).map((e) => (
              <li key={e.itemId}>
                <DreamImage image={e.image} alt="" size={34} />
                <span>{e.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.reasons.length ? (
        <Disclosure summary="Why this verdict" icon={<Scale />}>
          <ul className={styles.bullets}>
            {r.reasons.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </Disclosure>
      ) : null}
    </Card>
  )
}

// ───────────────────────────── goals ─────────────────────────────

const selectDreams = (s: AppSnapshot): DreamItem[] => s.state.dreams

function etaText(g: GoalProgress): string {
  if (g.pct >= 100) return 'Ready when you are'
  if (g.etaDate) return `ETA ${new Date(`${g.etaDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
  return g.saved > 0 ? 'Keep feeding the pot' : 'Not started yet'
}

export function GoalsCard({ card }: CardProps<'goals'>) {
  const currency = useCurrency()
  const dreams = useSnapshot(selectDreams)
  const saved = card.goals.reduce((sum, g) => sum + g.saved, 0)
  const single = card.goals.length === 1
  return (
    <Card as="section" className={styles.goals}>
      <CardHeader
        title={single ? card.goals[0].name : 'Your dreams'}
        subtitle={single ? `${Math.round(card.goals[0].pct)}% saved` : `${card.goals.length} dreams · ${fmt(saved, currency)} saved`}
        icon={<Sparkles />}
      />
      <ul className={cx(styles.goalGrid, single && styles.goalSingle)}>
        {card.goals.map((g) => {
          const dream = dreams.find((d) => d.id === g.itemId)
          return (
            <li key={g.itemId} className={styles.goalTile}>
              <ProgressRing value={g.pct} max={100} size={single ? 96 : 80} thickness={7} tone={g.pct >= 100 ? 'accent' : 'under'} label={`${g.name} saved`} valueText={`${Math.round(g.pct)}% of ${fmt(g.price, currency)}`}>
                {dream ? <DreamImage image={dream.image} alt="" size={single ? 54 : 44} /> : <PiggyBank aria-hidden="true" />}
              </ProgressRing>
              <div className={styles.goalText}>
                <p className={styles.goalName}>{g.name}</p>
                <p className={styles.goalAmounts}>
                  <Money amount={g.saved} currency={currency} size="sm" /> <span>/ {fmt(g.price, currency, { compact: true })}</span>
                </p>
                <p className={styles.goalEta}>{Math.round(g.pct)}% · {etaText(g)}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
