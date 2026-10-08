import { CalendarClock, Check, Clock3, Gift, Pencil, PiggyBank, Plus, Sparkles, Target, TrendingUp } from 'lucide-react'
import type { CSSProperties } from 'react'
import { hoursOfWork } from '../../../core/finance'
import type { Currency, Profile } from '../../../core/types'
import { DreamImage } from '../../components/brand'
import { Badge, Button, IconButton, Money, ProgressRing } from '../../components/ds'
import { etaFact, fmtWhole, isFunded, monthYear, remainingOf, type DreamRow } from './model'
import styles from './DreamCard.module.css'

export interface DreamCardProps {
  row: DreamRow
  currency: Currency
  profile: Profile | null
  /** stagger index for the entrance */
  index?: number
  onAdd?: () => void
  onAchieve: () => void
  onEdit: () => void
}

/** One goal: the dream inside its progress ring, saved/price, pace, ETA and the pot — plus Add money. */
export function GoalCard({ row, currency, index = 0, onAdd, onAchieve, onEdit }: DreamCardProps) {
  const { item, progress: p } = row
  const funded = isFunded(p)
  const pct = p?.pct ?? 0
  const left = remainingOf(p)
  const eta = etaFact(p)
  return (
    <article className={styles.card} data-funded={funded || undefined} style={{ '--i': index } as CSSProperties} aria-labelledby={`${item.id}-name`}>
      <div className={styles.top}>
        <ProgressRing value={pct} size={104} thickness={8} tone={funded ? 'accent' : 'under'} label={`${item.name} saved`} valueText={`${Math.floor(pct)}% saved`} className={styles.ring}>
          <DreamImage image={item.image} alt="" size={68} className={styles.dream} />
        </ProgressRing>
        <div className={styles.info}>
          <div className={styles.badges}>
            <Badge size="sm" variant={funded ? 'accent' : 'neutral'} icon={funded ? <Sparkles /> : <Target />}>{funded ? 'Fully funded' : 'Goal'}</Badge>
            <span className={styles.pct}>{Math.floor(pct)}%</span>
          </div>
          <h3 id={`${item.id}-name`} className={styles.name}>{item.name}</h3>
          <p className={styles.amounts}>
            <Money amount={p?.saved ?? 0} currency={currency} size="lg" decimals={false} tone={funded ? 'under' : 'neutral'} />
            <span className={styles.of}>of {fmtWhole(item.price, currency)}</span>
          </p>
        </div>
        <IconButton label={`Edit ${item.name}`} icon={<Pencil />} size="md" variant="ghost" onClick={onEdit} className={styles.edit} />
      </div>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt><TrendingUp aria-hidden="true" />Pace</dt>
          <dd>
            <span className={styles.factValue}>{p && p.monthlyRate > 0 ? `${fmtWhole(p.monthlyRate, currency)}/mo` : '—'}</span>
            <span className={styles.factSub}>{p && p.monthlyRate > 0 ? '3-month average' : 'No monthly habit yet'}</span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt><CalendarClock aria-hidden="true" />ETA</dt>
          <dd>
            <span className={styles.factValue}>{eta.value}</span>
            <span className={styles.factSub}>{eta.sub}</span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt><PiggyBank aria-hidden="true" />Pot</dt>
          <dd>
            <span className={styles.factValue}>{fmtWhole(p?.saved ?? 0, currency)}</span>
            <span className={styles.factSub}>{left > 0 ? `${fmtWhole(left, currency)} to go` : 'all there'}</span>
          </dd>
        </div>
      </dl>

      <div className={styles.actions}>
        {funded ? (
          <Button iconStart={<Check />} onClick={onAchieve} fullWidth>Mark achieved</Button>
        ) : (
          <Button variant="soft" iconStart={<Plus />} onClick={onAdd} fullWidth>Add money</Button>
        )}
      </div>
    </article>
  )
}

/** A treat: a guilt-free reward with no pot — shown with its price in hours of work, never a "buy" button. */
export function TreatCard({ row, currency, profile, index = 0, onAchieve, onEdit }: DreamCardProps) {
  const { item } = row
  const hours = profile ? hoursOfWork(item.price, profile) : 0
  return (
    <article className={styles.treat} style={{ '--i': index } as CSSProperties} aria-labelledby={`${item.id}-name`}>
      <DreamImage image={item.image} alt="" size={64} className={styles.treatArt} />
      <div className={styles.treatInfo}>
        <h3 id={`${item.id}-name`} className={styles.treatName}>{item.name}</h3>
        <p className={styles.treatMeta}>
          <Money amount={item.price} currency={currency} size="sm" decimals={false} />
          {hours > 0 ? (
            <span className={styles.hours}><Clock3 aria-hidden="true" />{hours} h of work</span>
          ) : null}
        </p>
      </div>
      <div className={styles.treatActions}>
        <IconButton label={`Mark ${item.name} as enjoyed`} icon={<Check />} variant="secondary" onClick={onAchieve} />
        <IconButton label={`Edit ${item.name}`} icon={<Pencil />} onClick={onEdit} />
      </div>
    </article>
  )
}

/** An achieved dream on the shelf. */
export function AchievedCard({ row, currency, onEdit }: Pick<DreamCardProps, 'row' | 'currency' | 'onEdit'>) {
  const { item } = row
  return (
    <li className={styles.trophy}>
      <span className={styles.trophyArt}>
        <DreamImage image={item.image} alt="" size={56} />
        <span className={styles.trophyCheck} aria-hidden="true">{item.kind === 'goal' ? <Check /> : <Gift />}</span>
      </span>
      <span className={styles.trophyName}>{item.name}</span>
      <span className={styles.trophyMeta}>
        {fmtWhole(item.price, currency)}
        {item.achievedAt ? ` · ${monthYear(item.achievedAt)}` : ''}
      </span>
      <button type="button" className={styles.trophyEdit} onClick={onEdit} aria-label={`Edit ${item.name}`}>
        <Pencil aria-hidden="true" />
      </button>
    </li>
  )
}
